/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const enum MarketplaceEligibilityReason {
	GitHubEnterprise = 'gitHubEnterprise',
	CopilotSKU = 'copilotSKU',
	EntraID = 'entraID',
	VisualStudioSubscription = 'visualStudioSubscription',
	Ineligible = 'ineligible',
}

export interface IMarketplaceEligibility {
	readonly eligible: boolean;
	readonly reason: MarketplaceEligibilityReason;
}

export interface IMarketplaceEligibilityService {
	readonly _serviceBrand: undefined;

	/**
	 * Checks marketplace eligibility across all available auth paths
	 * (GitHub Enterprise, Entra ID, Visual Studio Subscription).
	 */
	checkEligibility(): Promise<IMarketplaceEligibility>;

	/**
	 * Fires when eligibility changes (e.g., due to auth session changes).
	 */
	readonly onDidChangeEligibility: Event<IMarketplaceEligibility>;

	/**
	 * Triggers sign-in with the Microsoft authentication provider.
	 */
	signInWithMicrosoft(): Promise<void>;

	/**
	 * Whether any Microsoft auth session currently exists.
	 */
	readonly hasMicrosoftSession: boolean;
}

export const IMarketplaceEligibilityService = createDecorator<IMarketplaceEligibilityService>('marketplaceEligibilityService');
