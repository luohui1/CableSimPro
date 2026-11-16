// pi's session layer takes a few seconds to load, so the sidecar starts without it and the first conversation pays once.
// Install telemetry and catalogue downloads are off: the only network traffic is the model the platform holds.
let loaded: Promise<typeof import('@earendil-works/pi-coding-agent')> | undefined;

export function pi() {
  process.env.PI_TELEMETRY ??= '0';
  process.env.PI_OFFLINE ??= '1';
  return (loaded ??= import('@earendil-works/pi-coding-agent'));
}
