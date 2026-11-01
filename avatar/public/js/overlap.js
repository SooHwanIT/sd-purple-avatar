// v6 neck attaches to the jaw at its upper edge and to the collar at its base.
// Each neck/neck-line vertex uses the same continuous weight, avoiding sliding
// skin edges when the head turns independently of the body.
export function neckAttachmentWeight(y, neck, profile) {
  const end = profile?.neckJoinY;
  const high = end ?? neck.top;
  const u = Math.max(0, Math.min(1, (neck.bottom - y) / Math.max(1, neck.bottom - high)));
  return u * u * (3 - 2 * u) * (end == null ? .6 : profile.neckStrength ?? 1);
}
