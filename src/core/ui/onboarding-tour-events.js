export const TOUR_EVENT = "year-view:restart-tour";

export function restartOnboardingTour(documentRoot = document) {
    documentRoot.dispatchEvent(new CustomEvent(TOUR_EVENT));
}
