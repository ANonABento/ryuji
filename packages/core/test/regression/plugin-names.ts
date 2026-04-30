export const REGRESSION_PLUGIN_NAMES = [
  "automod",
  "voice",
  "browser",
  "tutor",
  "socials",
] as const;

export type RegressionPluginName =
  (typeof REGRESSION_PLUGIN_NAMES)[number];
