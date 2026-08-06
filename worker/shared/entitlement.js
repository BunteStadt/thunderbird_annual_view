export const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active"]);

export function hasActiveSubscription(status) {
    return !!status && ACTIVE_SUBSCRIPTION_STATUSES.has(status);
}