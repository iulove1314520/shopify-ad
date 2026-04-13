# TikTok Purchase Single-Source Design

**Date:** 2026-04-13  
**Status:** Approved in chat at the approach level, pending spec review

## Goal

Make the self-hosted backend callback the only TikTok `Purchase` source while keeping browser-side TikTok page signals available for `_ttp`, page context, and general web attribution support.

## Current State

- The storefront already injects a custom visitor tracker and reports `ttclid`, `product_id`, `timestamp`, and optional `ttp` when present.
- The backend match engine links some orders to TikTok visitors and sends `Purchase` to TikTok Events API through `server/src/services/tiktok.js`.
- The storefront also contains Shopify Web Pixels configuration with a TikTok app pixel code.
- TikTok Events Manager shows active `Purchase` events, but the matching-identifier coverage shown in the UI is effectively `0%` for the recent sample.
- Recent self-hosted callback summaries show that the backend is sending stronger match context than what TikTok appears to credit in the UI:
  - `ttclid`
  - `ip`
  - `user_agent`
  - hashed `email`
  - hashed `external_id`
- Recent visitor records still often lack `ttp`.

## Problem Statement

TikTok currently appears to receive at least two logically different purchase-related data flows tied to the same pixel:

1. a Shopify-managed TikTok/Events API flow
2. the self-hosted purchase callback flow

This creates three problems:

- attribution ambiguity: Ads Manager may attribute against the weaker or earlier-arriving event source
- debugging ambiguity: operators cannot tell whether a `Purchase` shown in TikTok came from Shopify-managed delivery or the self-hosted callback
- match-quality dilution: the event stream TikTok is surfacing in EMQ views may not be the enriched self-hosted payload

## Chosen Approach

Use a dual-protection strategy:

1. keep browser-side TikTok page signals active
2. make self-hosted callback the only allowed TikTok `Purchase` path
3. explicitly label and surface that mode inside the local system
4. require merchant-side disabling of Shopify/TikTok native `Purchase` emission

This is intentionally not a full "replace all TikTok browser integrations" project. We keep the browser-side layer because it is still useful for `_ttp`, page activity, and click-to-browser continuity.

## Alternatives Considered

### A. Keep both purchase flows and rely on TikTok deduplication

Rejected because the current symptoms already suggest this is not producing a clean or interpretable result.

### B. Keep Shopify/TikTok native purchase and disable self-hosted purchase

Rejected because the self-hosted system is the only layer that currently understands:

- visitor matching results
- test-traffic labeling
- local callback observability
- the exact click/order linkage logic used in this project

### C. Fully self-manage browser pixel plus Events API

Deferred because it increases operational complexity and is not necessary to resolve the current ambiguity.

## Design Decisions

### 1. Introduce an explicit TikTok purchase mode

Add a dedicated configuration value:

- `TIKTOK_PURCHASE_MODE=self_hosted_only`

Supported modes should be:

- `self_hosted_only`
  - backend TikTok `Purchase` callbacks are allowed
  - UI and callback summaries should indicate that self-hosted purchase is the intended sole source
- `disabled`
  - backend TikTok `Purchase` callbacks are suppressed
  - useful as a safety switch during incident handling

This mode does not itself disable Shopify-managed purchase delivery. That remains an external admin action, but the local system should surface the intended mode clearly.

### 2. Preserve browser-side TikTok signals

Do not remove or suppress:

- TikTok page view or browser-side pixel loading
- `_ttp` capture attempts in the storefront tracker
- visitor ingestion of `ttclid`, `ttp`, `ip`, `user_agent`

Reason: browser-side context still materially helps later server-side matching and attribution quality.

### 3. Make the self-hosted callback path observable

Every self-hosted TikTok callback should carry an explicit local source label in the callback summary, for example:

- `purchaseMode: "self_hosted_only"`
- `purchaseSource: "self_hosted_backend"`

This label is for local observability. It does not need to be sent to TikTok as a custom property unless the current API contract explicitly supports it safely.

### 4. Surface the active purchase mode in the local admin UI

Operators should be able to confirm, from the local dashboard or system endpoint, that the intended TikTok purchase mode is active.

Minimum acceptable visibility:

- `GET /api/system` or equivalent configuration summary exposes the current mode
- Web UI shows `TikTok Purchase Mode: self_hosted_only`

This reduces future confusion when comparing TikTok Events Manager with local callback logs.

### 5. Separate code responsibility from merchant responsibility

The codebase can enforce local purchase behavior, but it cannot by itself disable Shopify/TikTok native purchase emission already configured in merchant admin.

The implementation must therefore be paired with an operator runbook:

- keep TikTok pixel/browser event layer enabled
- disable Shopify/TikTok native `Purchase` sharing for the connected pixel/data source
- retain page-level/browser-level signals where possible

This runbook should be documented in plain language for the merchant.

## Files and Responsibilities

- `server/src/config/env.js`
  - parse and validate `TIKTOK_PURCHASE_MODE`
- `server/src/services/tiktok.js`
  - honor the purchase mode when building/sending TikTok purchase callbacks
  - add local callback summary fields such as `purchaseMode` and `purchaseSource`
- `server/src/modules/match.js`
  - preserve current match behavior
  - ensure callback results clearly reflect when a callback was intentionally skipped because TikTok purchase mode is disabled
- `server/src/modules/system.js`
  - expose TikTok purchase mode in the system/config summary
- `server/public/app.js`
  - show the active TikTok purchase mode in the dashboard
- `README.md`
  - document the new environment variable and merchant-side single-source requirement
- `docx/tiktok-purchase-single-source-runbook.md`
  - add a short operator runbook for disabling native TikTok `Purchase` while keeping browser signals

## Error Handling

- If `TIKTOK_PURCHASE_MODE` is missing, default to `self_hosted_only` so current production behavior does not silently stop sending TikTok `Purchase`.
- If the mode is invalid, surface a clear configuration issue in system diagnostics.
- If the mode is `disabled`, TikTok callbacks should be skipped intentionally and recorded as such, not treated as transport failures.
- Merchant-side failure to disable native `Purchase` is not a code error, but the docs and UI should make this dependency explicit.

## Verification Strategy

- Add tests for environment parsing and mode validation.
- Add tests proving:
  - `self_hosted_only` still sends TikTok purchase callbacks
  - `disabled` skips them with an intentional status
  - callback summaries include the local purchase mode/source labels
- Verify the system/config endpoint exposes the current TikTok purchase mode.
- After deployment, confirm:
  - local callbacks still succeed
  - TikTok Events Manager no longer shows ambiguous duplicate purchase sourcing
  - future EMQ and attribution checks are performed only after merchant-side native `Purchase` is disabled

## Success Criteria

- The local system has an explicit, inspectable TikTok purchase mode.
- Self-hosted TikTok `Purchase` callbacks remain functional in `self_hosted_only` mode.
- Operators can distinguish intentional callback suppression from transport failure.
- Merchant documentation clearly instructs how to disable Shopify/TikTok native `Purchase` while retaining browser-side TikTok signals.
- Future TikTok `Purchase` debugging no longer has ambiguous ownership between Shopify-managed and self-hosted purchase flows.
