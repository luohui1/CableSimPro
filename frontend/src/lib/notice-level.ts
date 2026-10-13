/** Presentation-only updates never invalidate an already verified calculation. */
export function isResultInformation(message: string) {
  return /^方法说明已更新[，；,;]\s*保存结果仍有效[。.]?$/.test(message.trim());
}
