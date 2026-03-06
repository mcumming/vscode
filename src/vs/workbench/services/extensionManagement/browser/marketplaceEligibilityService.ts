/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IDefaultAccount } from '../../../../base/common/defaultAccount.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IDefaultAccountService } from '../../../../platform/defaultAccount/common/defaultAccount.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { asJson, IRequestService } from '../../../../platform/request/common/request.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IAuthenticationService } from '../../authentication/common/authentication.js';
import { CONTEXT_MARKETPLACE_ELIGIBILITY_CHECKED, CONTEXT_MARKETPLACE_ELIGIBLE_VIA_GITHUB, CONTEXT_MARKETPLACE_ELIGIBLE_VIA_MICROSOFT, CONTEXT_MARKETPLACE_ELIGIBLE_VIA_VSS } from '../../../contrib/extensions/common/extensions.js';
import { IMarketplaceEligibility, IMarketplaceEligibilityService, MarketplaceEligibilityReason } from '../common/marketplaceEligibility.js';

interface IEligibilityResponse {
	readonly accountType?: 'Entra' | 'MSA';
	readonly eligible?: boolean;
	readonly reason?: string;
}

type MarketplaceEligibilityEvent = {
	reason: string;
	provider: string;
	hasVSS: boolean;
};

type MarketplaceEligibilityClassification = {
	reason: {
		classification: 'SystemMetaData';
		purpose: 'FeatureInsight';
		comment: 'Which eligibility path granted marketplace access (gitHubEnterprise, copilotSKU, entraID, visualStudioSubscription, ineligible).';
	};
	provider: {
		classification: 'SystemMetaData';
		purpose: 'FeatureInsight';
		comment: 'The authentication provider used (github, microsoft, none).';
	};
	hasVSS: {
		classification: 'SystemMetaData';
		purpose: 'FeatureInsight';
		isMeasurement: true;
		comment: 'Whether the user has an active Visual Studio Subscription.';
	};
	owner: 'sandy081';
	comment: 'Reports private marketplace eligibility check results to track adoption of Entra ID and VSS sign-in paths.';
};

export class MarketplaceEligibilityService extends Disposable implements IMarketplaceEligibilityService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeEligibility = this._register(new Emitter<IMarketplaceEligibility>());
	readonly onDidChangeEligibility = this._onDidChangeEligibility.event;

	private _hasMicrosoftSession = false;
	get hasMicrosoftSession(): boolean { return this._hasMicrosoftSession; }

	private cachedResult: IMarketplaceEligibility | undefined;

	private readonly eligibilityCheckedKey: IContextKey<boolean>;
	private readonly eligibleViaGitHubKey: IContextKey<boolean>;
	private readonly eligibleViaMicrosoftKey: IContextKey<boolean>;
	private readonly eligibleViaVSSKey: IContextKey<boolean>;

	constructor(
		@IDefaultAccountService private readonly defaultAccountService: IDefaultAccountService,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
		@IRequestService private readonly requestService: IRequestService,
		@IProductService private readonly productService: IProductService,
		@ILogService private readonly logService: ILogService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
	) {
		super();

		this.eligibilityCheckedKey = CONTEXT_MARKETPLACE_ELIGIBILITY_CHECKED.bindTo(contextKeyService);
		this.eligibleViaGitHubKey = CONTEXT_MARKETPLACE_ELIGIBLE_VIA_GITHUB.bindTo(contextKeyService);
		this.eligibleViaMicrosoftKey = CONTEXT_MARKETPLACE_ELIGIBLE_VIA_MICROSOFT.bindTo(contextKeyService);
		this.eligibleViaVSSKey = CONTEXT_MARKETPLACE_ELIGIBLE_VIA_VSS.bindTo(contextKeyService);

		// Re-evaluate eligibility when GitHub account changes
		this._register(this.defaultAccountService.onDidChangeDefaultAccount(() => this.onAuthChanged()));

		// Re-evaluate eligibility when Microsoft sessions change
		this._register(this.authenticationService.onDidChangeSessions(e => {
			if (e.providerId === 'microsoft') {
				this.onAuthChanged();
			}
		}));
	}

	private async onAuthChanged(): Promise<void> {
		this.cachedResult = undefined;
		const result = await this.checkEligibility();
		this._onDidChangeEligibility.fire(result);
	}

	async checkEligibility(): Promise<IMarketplaceEligibility> {
		if (this.cachedResult) {
			return this.cachedResult;
		}

		// Path 1: GitHub Enterprise / Copilot SKU
		const githubResult = await this.checkGitHubEligibility();
		if (githubResult.eligible) {
			this.updateResult(githubResult, 'github');
			return githubResult;
		}

		// Paths 2 & 3: Entra ID / Visual Studio Subscription
		const microsoftResult = await this.checkMicrosoftEligibility();
		this.updateResult(microsoftResult, microsoftResult.reason !== MarketplaceEligibilityReason.Ineligible ? 'microsoft' : 'none');
		return microsoftResult;
	}

	private async checkGitHubEligibility(): Promise<IMarketplaceEligibility> {
		const account = await this.defaultAccountService.getDefaultAccount();
		if (!account) {
			return { eligible: false, reason: MarketplaceEligibilityReason.Ineligible };
		}

		if (this.hasAccessViaSKU(account)) {
			return { eligible: true, reason: MarketplaceEligibilityReason.CopilotSKU };
		}

		if (account.enterprise) {
			return { eligible: true, reason: MarketplaceEligibilityReason.GitHubEnterprise };
		}

		return { eligible: false, reason: MarketplaceEligibilityReason.Ineligible };
	}

	private hasAccessViaSKU(account: IDefaultAccount): boolean {
		const accessSKUs = this.productService.extensionsGallery?.accessSKUs;
		const userSKU = account.entitlementsData?.access_type_sku;
		return !!(userSKU && accessSKUs?.includes(userSKU));
	}

	private async checkMicrosoftEligibility(): Promise<IMarketplaceEligibility> {
		const eligibilityUrl = this.productService.extensionsGallery?.eligibilityUrl;
		if (!eligibilityUrl) {
			this.logService.debug('[Marketplace] No eligibility URL configured');
			return { eligible: false, reason: MarketplaceEligibilityReason.Ineligible };
		}

		const scopes = this.productService.extensionsGallery?.microsoftAuthScopes;
		if (!scopes || scopes.length === 0) {
			this.logService.debug('[Marketplace] No Microsoft auth scopes configured');
			return { eligible: false, reason: MarketplaceEligibilityReason.Ineligible };
		}

		try {
			const sessions = await this.authenticationService.getSessions('microsoft', scopes);
			this._hasMicrosoftSession = sessions.length > 0;

			if (sessions.length === 0) {
				return { eligible: false, reason: MarketplaceEligibilityReason.Ineligible };
			}

			// Use the first available session
			const session = sessions[0];
			return await this.callEligibilityEndpoint(eligibilityUrl, session.accessToken);
		} catch (error) {
			this.logService.error('[Marketplace] Error checking Microsoft eligibility', error);
			this._hasMicrosoftSession = false;
			return { eligible: false, reason: MarketplaceEligibilityReason.Ineligible };
		}
	}

	private async callEligibilityEndpoint(url: string, token: string): Promise<IMarketplaceEligibility> {
		try {
			const context = await this.requestService.request({
				type: 'POST',
				url,
				headers: {
					'Authorization': `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
			}, CancellationToken.None);

			if (context.res.statusCode !== 200) {
				this.logService.error(`[Marketplace] Eligibility endpoint returned status ${context.res.statusCode}`);
				return { eligible: false, reason: MarketplaceEligibilityReason.Ineligible };
			}

			const response = await asJson<IEligibilityResponse>(context);
			if (!response) {
				this.logService.error('[Marketplace] Eligibility endpoint returned empty response');
				return { eligible: false, reason: MarketplaceEligibilityReason.Ineligible };
			}

			if (response.accountType === 'Entra') {
				return { eligible: true, reason: MarketplaceEligibilityReason.EntraID };
			}

			// MSA account — server-side Ev4 check was already performed
			if (response.accountType === 'MSA' && response.eligible) {
				return { eligible: true, reason: MarketplaceEligibilityReason.VisualStudioSubscription };
			}

			return { eligible: false, reason: MarketplaceEligibilityReason.Ineligible };
		} catch (error) {
			this.logService.error('[Marketplace] Error calling eligibility endpoint', error);
			return { eligible: false, reason: MarketplaceEligibilityReason.Ineligible };
		}
	}

	private updateResult(result: IMarketplaceEligibility, provider: string): void {
		this.cachedResult = result;

		this.eligibilityCheckedKey.set(true);
		this.eligibleViaGitHubKey.set(
			result.reason === MarketplaceEligibilityReason.GitHubEnterprise
			|| result.reason === MarketplaceEligibilityReason.CopilotSKU
		);
		this.eligibleViaMicrosoftKey.set(result.reason === MarketplaceEligibilityReason.EntraID);
		this.eligibleViaVSSKey.set(result.reason === MarketplaceEligibilityReason.VisualStudioSubscription);

		this.telemetryService.publicLog2<MarketplaceEligibilityEvent, MarketplaceEligibilityClassification>(
			'marketplace:eligibility:checked',
			{
				reason: result.reason,
				provider,
				hasVSS: result.reason === MarketplaceEligibilityReason.VisualStudioSubscription,
			}
		);
	}

	async signInWithMicrosoft(): Promise<void> {
		const scopes = this.productService.extensionsGallery?.microsoftAuthScopes;
		if (!scopes || scopes.length === 0) {
			this.logService.error('[Marketplace] No Microsoft auth scopes configured for sign-in');
			return;
		}

		try {
			await this.authenticationService.createSession('microsoft', scopes);
			// Session change event will trigger re-evaluation
		} catch (error) {
			this.logService.error('[Marketplace] Error signing in with Microsoft', error);
		}
	}
}

registerSingleton(IMarketplaceEligibilityService, MarketplaceEligibilityService, InstantiationType.Delayed);
