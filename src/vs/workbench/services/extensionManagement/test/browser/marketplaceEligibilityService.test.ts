/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { bufferToStream, VSBuffer } from '../../../../../base/common/buffer.js';
import { IDefaultAccount } from '../../../../../base/common/defaultAccount.js';
import { Emitter } from '../../../../../base/common/event.js';
import { IRequestContext, IRequestOptions } from '../../../../../base/parts/request/common/request.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IDefaultAccountService } from '../../../../../platform/defaultAccount/common/defaultAccount.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { IRequestService } from '../../../../../platform/request/common/request.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { NullTelemetryService } from '../../../../../platform/telemetry/common/telemetryUtils.js';
import { AuthenticationSession, AuthenticationSessionsChangeEvent, IAuthenticationService } from '../../../authentication/common/authentication.js';
import { MarketplaceEligibilityService } from '../../browser/marketplaceEligibilityService.js';
import { MarketplaceEligibilityReason } from '../../common/marketplaceEligibility.js';

function mockResponse(statusCode: number, body: object): IRequestContext {
	return {
		res: { headers: {}, statusCode },
		stream: bufferToStream(VSBuffer.fromString(JSON.stringify(body))),
	};
}

function createDefaultAccount(overrides: Partial<IDefaultAccount> = {}): IDefaultAccount {
	return {
		authenticationProvider: { id: 'github', name: 'GitHub', enterprise: false },
		accountName: 'testuser',
		sessionId: 'session-1',
		enterprise: false,
		entitlementsData: undefined,
		...overrides,
	};
}

function createMicrosoftSession(accessToken = 'ms-token'): AuthenticationSession {
	return {
		id: 'ms-session-1',
		accessToken,
		account: { id: 'ms-account-1', label: 'user@contoso.com' },
		scopes: ['openid', 'profile'],
	};
}

suite('MarketplaceEligibilityService', () => {

	const disposableStore = ensureNoDisposablesAreLeakedInTestSuite();

	let instantiationService: TestInstantiationService;
	let onDidChangeDefaultAccount: Emitter<IDefaultAccount | null>;
	let onDidChangeSessions: Emitter<{ providerId: string; label: string; event: AuthenticationSessionsChangeEvent }>;
	let defaultAccount: IDefaultAccount | null;
	let microsoftSessions: AuthenticationSession[];
	let requestHandler: (options: IRequestOptions) => IRequestContext;

	setup(() => {
		defaultAccount = null;
		microsoftSessions = [];
		requestHandler = () => mockResponse(200, {});

		onDidChangeDefaultAccount = disposableStore.add(new Emitter<IDefaultAccount | null>());
		onDidChangeSessions = disposableStore.add(new Emitter<{ providerId: string; label: string; event: AuthenticationSessionsChangeEvent }>());

		instantiationService = disposableStore.add(new TestInstantiationService());

		instantiationService.stub(IDefaultAccountService, new class extends mock<IDefaultAccountService>() {
			override readonly onDidChangeDefaultAccount = onDidChangeDefaultAccount.event;
			override async getDefaultAccount() { return defaultAccount; }
		}());

		instantiationService.stub(IAuthenticationService, new class extends mock<IAuthenticationService>() {
			override readonly onDidChangeSessions = onDidChangeSessions.event;
			override async getSessions(providerId: string) {
				if (providerId === 'microsoft') {
					return microsoftSessions;
				}
				return [];
			}
			override async createSession(providerId: string) {
				return createMicrosoftSession();
			}
		}());

		instantiationService.stub(IRequestService, new class extends mock<IRequestService>() {
			override async request(options: IRequestOptions) {
				return requestHandler(options);
			}
		}());

		instantiationService.stub(IProductService, {
			extensionsGallery: {
				eligibilityUrl: 'https://marketplace.example.com/eligibility',
				microsoftAuthScopes: ['openid', 'profile'],
				accessSKUs: ['copilot_business'],
			},
		} as any);

		instantiationService.stub(ILogService, new NullLogService());
		instantiationService.stub(IContextKeyService, disposableStore.add(new MockContextKeyService()));
		instantiationService.stub(ITelemetryService, NullTelemetryService);
	});

	function createService(): MarketplaceEligibilityService {
		return disposableStore.add(instantiationService.createInstance(MarketplaceEligibilityService));
	}

	test('eligible via GitHub Enterprise account', async () => {
		defaultAccount = createDefaultAccount({ enterprise: true });
		const service = createService();
		const result = await service.checkEligibility();
		assert.deepStrictEqual(result, {
			eligible: true,
			reason: MarketplaceEligibilityReason.GitHubEnterprise,
		});
	});

	test('eligible via Copilot SKU match', async () => {
		defaultAccount = createDefaultAccount({
			entitlementsData: { access_type_sku: 'copilot_business' } as any,
		});
		const service = createService();
		const result = await service.checkEligibility();
		assert.deepStrictEqual(result, {
			eligible: true,
			reason: MarketplaceEligibilityReason.CopilotSKU,
		});
	});

	test('eligible via Entra ID account', async () => {
		microsoftSessions = [createMicrosoftSession()];
		requestHandler = () => mockResponse(200, { accountType: 'Entra' });
		const service = createService();
		const result = await service.checkEligibility();
		assert.deepStrictEqual(result, {
			eligible: true,
			reason: MarketplaceEligibilityReason.EntraID,
		});
	});

	test('eligible via Visual Studio Subscription for MSA user', async () => {
		microsoftSessions = [createMicrosoftSession()];
		requestHandler = () => mockResponse(200, { accountType: 'MSA', eligible: true, reason: 'VSS' });
		const service = createService();
		const result = await service.checkEligibility();
		assert.deepStrictEqual(result, {
			eligible: true,
			reason: MarketplaceEligibilityReason.VisualStudioSubscription,
		});
	});

	test('ineligible MSA without VSS', async () => {
		microsoftSessions = [createMicrosoftSession()];
		requestHandler = () => mockResponse(200, { accountType: 'MSA', eligible: false });
		const service = createService();
		const result = await service.checkEligibility();
		assert.deepStrictEqual(result, {
			eligible: false,
			reason: MarketplaceEligibilityReason.Ineligible,
		});
	});

	test('ineligible with no accounts', async () => {
		const service = createService();
		const result = await service.checkEligibility();
		assert.deepStrictEqual(result, {
			eligible: false,
			reason: MarketplaceEligibilityReason.Ineligible,
		});
	});

	test('re-evaluates on GitHub account change', async () => {
		const service = createService();

		// Start ineligible
		const initial = await service.checkEligibility();
		assert.deepStrictEqual(initial, { eligible: false, reason: MarketplaceEligibilityReason.Ineligible });

		// Set up enterprise account and fire change
		defaultAccount = createDefaultAccount({ enterprise: true });
		const changed = new Promise<void>(resolve => {
			disposableStore.add(service.onDidChangeEligibility(result => {
				assert.deepStrictEqual(result, {
					eligible: true,
					reason: MarketplaceEligibilityReason.GitHubEnterprise,
				});
				resolve();
			}));
		});
		onDidChangeDefaultAccount.fire(defaultAccount);
		await changed;
	});

	test('re-evaluates on Microsoft session change', async () => {
		const service = createService();

		// Start ineligible
		const initial = await service.checkEligibility();
		assert.deepStrictEqual(initial, { eligible: false, reason: MarketplaceEligibilityReason.Ineligible });

		// Set up Microsoft session with Entra response
		microsoftSessions = [createMicrosoftSession()];
		requestHandler = () => mockResponse(200, { accountType: 'Entra' });
		const changed = new Promise<void>(resolve => {
			disposableStore.add(service.onDidChangeEligibility(result => {
				assert.deepStrictEqual(result, {
					eligible: true,
					reason: MarketplaceEligibilityReason.EntraID,
				});
				resolve();
			}));
		});
		onDidChangeSessions.fire({ providerId: 'microsoft', label: 'Microsoft', event: { added: undefined, removed: undefined, changed: undefined } });
		await changed;
	});

	test('ignores non-microsoft session changes', async () => {
		const service = createService();
		let fired = false;
		disposableStore.add(service.onDidChangeEligibility(() => { fired = true; }));
		onDidChangeSessions.fire({ providerId: 'github', label: 'GitHub', event: { added: undefined, removed: undefined, changed: undefined } });

		// Give a tick for any async handlers to run
		await new Promise<void>(resolve => setTimeout(resolve, 10));
		assert.strictEqual(fired, false);
	});

	test('GitHub path takes priority over Entra', async () => {
		defaultAccount = createDefaultAccount({ enterprise: true });
		microsoftSessions = [createMicrosoftSession()];
		requestHandler = () => mockResponse(200, { accountType: 'Entra' });
		const service = createService();
		const result = await service.checkEligibility();
		assert.deepStrictEqual(result, {
			eligible: true,
			reason: MarketplaceEligibilityReason.GitHubEnterprise,
		});
	});

	test('VSS with inactive subscription is ineligible', async () => {
		microsoftSessions = [createMicrosoftSession()];
		requestHandler = () => mockResponse(200, { accountType: 'MSA', eligible: false });
		const service = createService();
		const result = await service.checkEligibility();
		assert.deepStrictEqual(result, {
			eligible: false,
			reason: MarketplaceEligibilityReason.Ineligible,
		});
	});

	test('VSS with non-qualifying subscription level', async () => {
		microsoftSessions = [createMicrosoftSession()];
		requestHandler = () => mockResponse(200, { accountType: 'MSA', eligible: false });
		const service = createService();
		const result = await service.checkEligibility();
		assert.deepStrictEqual(result, {
			eligible: false,
			reason: MarketplaceEligibilityReason.Ineligible,
		});
	});
});
