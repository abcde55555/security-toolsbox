import type { ModuleConfig } from '@en18031/shared';

const config: ModuleConfig = {
  id: 'en18031-default-cred-check',
  name: '默认口令风险筛查',
  version: '1.0.0',
  sdkVersion: '^1.0.0',
  type: 'module',
  interactionMode: 'form',
  author: 'EN18031 Core Team',
  description:
    '非破坏性筛查模组：只探测常见管理服务（SSH/Telnet/HTTP/HTTPS/FTP）是否开放，为开放的管理端口生成「需人工核实默认口令是否已修改」的条款判定，不做任何口令爆破。',
  tags: ['EN18031-ch5', '默认口令', '筛查', '非破坏性', '不爆破'],
  category: 'credential-compliance',
  healthCheck: {
    command: 'nmap --version',
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
      description: '需要筛查默认口令风险的设备 IPv4 地址。',
    },
    {
      id: 'servicesToCheck',
      label: '待检查的管理服务',
      type: 'multiselect',
      value: ['ssh', 'telnet', 'http', 'https', 'ftp'],
      required: true,
      options: [
        { label: 'SSH (22)', value: 'ssh' },
        { label: 'Telnet (23)', value: 'telnet' },
        { label: 'HTTP 管理页 (80)', value: 'http' },
        { label: 'HTTPS 管理页 (443)', value: 'https' },
        { label: 'FTP (21)', value: 'ftp' },
      ],
      description: '勾选需要探测的管理服务类型，模组会把它们映射为对应端口做开放性探测。',
    },
    {
      id: 'timeoutMs',
      label: '探测超时（毫秒）',
      type: 'number',
      value: 10000,
      min: 3000,
      max: 300000,
      description: '单次 nmap 端口探测的最长允许时间。',
    },
  ],
  clauses: [
    { clauseId: '5.1-1', title: '默认账户必须强制修改密码', severity: 'high' },
    { clauseId: '5.3-4', title: '默认口令必须修改', severity: 'high' },
  ],
};

export default config;
