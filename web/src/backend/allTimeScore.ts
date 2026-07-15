// GitHub's public events endpoint is a rolling window, so a fresh recompute can be lower even
// though the developer did not undo any work. Renown is an all-time record: retain the highest
// base ever verified for each GitHub and add cumulative attribution on top of that floor.
export const advanceAllTimeVerifiedScore = ({
  currentVerifiedScore,
  currentAttributionScore,
  recomputedBaseScore,
  nextAttributionScore = currentAttributionScore,
}: {
  currentVerifiedScore: number;
  currentAttributionScore: number;
  recomputedBaseScore: number;
  nextAttributionScore?: number;
}) => {
  const previousBaseScore = Math.max(0, currentVerifiedScore - currentAttributionScore);
  const allTimeBaseScore = Math.max(previousBaseScore, recomputedBaseScore);
  return {
    previousBaseScore,
    recomputedBaseScore,
    allTimeBaseScore,
    attributionScore: nextAttributionScore,
    verifiedScore: allTimeBaseScore + nextAttributionScore,
  };
};
