import type { BaseModule } from '@en18031/shared';

import cryptoCheck from './en18031-crypto-check/index.js';
import defaultCredCheck from './en18031-default-cred-check/index.js';
import firmwareSecretScan from './en18031-firmware-secret-scan/index.js';
import portCheck from './en18031-port-check/index.js';

export { default as cryptoCheck } from './en18031-crypto-check/index.js';
export { default as defaultCredCheck } from './en18031-default-cred-check/index.js';
export { default as firmwareSecretScan } from './en18031-firmware-secret-scan/index.js';
export { default as portCheck } from './en18031-port-check/index.js';

/**
 * 平台内置合规模组清单。
 * 启动时由 ModuleLoader 读取，逐个校验 module.config 后注册为 builtin=true 的工具。
 */
export const builtInModules: BaseModule[] = [
  portCheck,
  cryptoCheck,
  defaultCredCheck,
  firmwareSecretScan,
];

export default builtInModules;
