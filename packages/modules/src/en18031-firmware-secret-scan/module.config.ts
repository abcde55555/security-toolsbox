import type { ModuleConfig } from '@en18031/shared';

const config: ModuleConfig = {
  id: 'en18031-firmware-secret-scan',
  name: '固件硬编码密钥扫描',
  version: '1.0.0',
  sdkVersion: '^1.0.0',
  type: 'module',
  interactionMode: 'form',
  author: 'EN18031 Core Team',
  description:
    '对固件镜像做静态字符串扫描，检出硬编码口令/API Key/私钥等敏感凭据，并识别 JTAG/UART 等调试接口线索；可选调用 binwalk 列出内嵌组件。所有证据自动截断脱敏。',
  tags: ['EN18031-ch5', '固件分析', '静态扫描', '硬编码密钥', '非破坏性'],
  category: 'firmware-analysis',
  healthCheck: {
    command: 'strings --version',
    timeoutMs: 5000,
  },
  formFields: [
    {
      id: 'firmwareFile',
      label: '固件文件',
      type: 'file',
      required: true,
      accept: '.bin,.hex,.img,.tar,.gz',
      maxSizeMb: 200,
      format: 'path',
      description:
        '上传待分析的固件镜像（服务端保存后把绝对路径注入本参数）。支持原始镜像与常见打包格式，单文件上限 200MB。',
    },
    {
      id: 'scanDepth',
      label: '扫描深度',
      type: 'select',
      value: 'quick',
      options: [
        { label: '快速（仅字符串特征匹配，秒级）', value: 'quick' },
        { label: '完整（字符串特征 + binwalk 组件枚举）', value: 'full' },
      ],
      description: 'full 模式会额外调用 binwalk 枚举内嵌文件系统与压缩组件，耗时明显更长。',
    },
    {
      id: 'timeoutMs',
      label: '单命令超时（毫秒）',
      type: 'number',
      value: 300000,
      min: 30000,
      max: 3600000,
      description: 'strings/grep 与 binwalk 各自的最长允许执行时间。',
    },
  ],
  clauses: [
    { clauseId: '5.5-1', title: '固件中不得存在硬编码密钥或凭据', severity: 'high' },
    { clauseId: '5.5-3', title: '调试接口 JTAG/UART 默认关闭', severity: 'middle' },
  ],
};

export default config;
