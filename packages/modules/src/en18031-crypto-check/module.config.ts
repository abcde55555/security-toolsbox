import type { ModuleConfig } from '@en18031/shared';

const config: ModuleConfig = {
  id: 'en18031-crypto-check',
  name: '加密传输合规检测',
  version: '1.0.0',
  sdkVersion: '^1.0.0',
  type: 'module',
  interactionMode: 'form',
  author: 'EN18031 Core Team',
  description:
    '通过 openssl s_client 抓取 TLS 证书信息，并用 nmap ssl-enum-ciphers 枚举加密套件与协议版本，判定 EN18031 第 5.4 节弱加密与证书合规要求。',
  tags: ['EN18031-ch5', 'TLS', '加密套件', '非破坏性'],
  category: 'crypto-compliance',
  healthCheck: {
    command: 'openssl version',
    timeoutMs: 5000,
  },
  formFields: [
    {
      id: 'targetIp',
      label: '目标 IP 地址',
      type: 'text',
      placeholder: '例如 192.168.1.100',
      required: true,
      format: 'ip',
      description: '需要检测 TLS 加密合规性的设备 IPv4 地址。',
    },
    {
      id: 'port',
      label: 'TLS 服务端口',
      type: 'number',
      value: 443,
      min: 1,
      max: 65535,
      required: true,
      description: '提供 TLS/SSL 服务的端口，常见为 443（HTTPS）、8443、993（IMAPS）等。',
    },
    {
      id: 'timeoutMs',
      label: '单命令超时（毫秒）',
      type: 'number',
      value: 30000,
      min: 5000,
      max: 600000,
      description: 'openssl 与 nmap 各自的最长允许执行时间。',
    },
  ],
  clauses: [
    { clauseId: '5.4-1', title: '通信加密套件不得使用已知弱算法', severity: 'high' },
    { clauseId: '5.4-2', title: 'TLS 证书必须合法有效且正确配置', severity: 'middle' },
  ],
};

export default config;
