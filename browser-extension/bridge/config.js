"use strict";

const HOST = "127.0.0.1";
const PORT_START = 49152;
const PORT_END = 49183;
const EXTENSION_ORIGIN = "chrome-extension://emfnepkalgoobcinjmjfmjigikeamfpj";
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_COMMAND_LENGTH = 32_000;
const COMMAND_TIMEOUT_MS = 60_000;
const DEFAULT_MINIMUM_SEND_DELAY_MS = 0;
const MAXIMUM_SEND_DELAY_MS = 180_000;
const DEEPSEEK_URL = "https://chat.deepseek.com/";

function configuredMinimumSendDelay(value = process.env.DS_PWSH_MIN_SEND_DELAY_MS) {
  if (value === undefined || value === "") return DEFAULT_MINIMUM_SEND_DELAY_MS;
  const delayMs = Number(value);
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > MAXIMUM_SEND_DELAY_MS) {
    throw new Error(
      `DS_PWSH_MIN_SEND_DELAY_MS must be an integer from 0 to ${MAXIMUM_SEND_DELAY_MS}.`,
    );
  }
  return delayMs;
}

module.exports = {
  HOST,
  PORT_START,
  PORT_END,
  EXTENSION_ORIGIN,
  MAX_REQUEST_BYTES,
  MAX_OUTPUT_BYTES,
  MAX_COMMAND_LENGTH,
  COMMAND_TIMEOUT_MS,
  DEFAULT_MINIMUM_SEND_DELAY_MS,
  MAXIMUM_SEND_DELAY_MS,
  DEEPSEEK_URL,
  configuredMinimumSendDelay,
};
