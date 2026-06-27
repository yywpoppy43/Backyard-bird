/**
 * Personalization profile — the (future) input that a personalization layer
 * derives deterministically from onboarding and feeds into the engine's seams.
 *
 * The V1 engine treats this as fully opaque: it never inspects it, it only
 * forwards it to whatever pluggable strategy was injected (a {@link CueSelector},
 * a {@link CueCalibrator}, or a {@link TippingPlanner}). The concrete shape is
 * owned by the personalization layer, so it can evolve without touching the
 * engine. When no profile is supplied, behaviour is exactly V1.
 */
export type PersonalizationProfile = Readonly<Record<string, unknown>>;
