import type { ModuleConfig } from '@en18031/shared';

const config: ModuleConfig = {
  id: 'en18031-port-check',
  name: '端口合规检测',
  version: '1.0.0',
  sdkVersion: '^1.0.0',
  type: 'module',
  interactionMode: 'form',
  author: 'EN18031 Core Team',
  description:
    '基于 nmap SYN 扫描 + 服务版本探测，检测目标开放端口是否符合 EN18031 第 5.3 节网络安全要求，自动判定 4 条核心条款。',
  tags: ['EN18031-ch5', '网络扫描', '非破坏性', '端口合规'],
  category: 'network-compliance',
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
      description:
        '需要做端口合规检测的单个设备 IPv4 地址。批量多目标请用模板编排的 for_each_json 展开或多个目标顺序执行。',
    },
    {
      id: 'portRange',
      label: '端口范围',
      type: 'text',
      value: '1-10000',
      required: true,
      format: 'port-range',
      description:
        '支持 nmap 语法：单端口 22、段 1-65535、列表 22,80,443；默认建议至少覆盖 1-10000 的常见服务端口。',
    },
    {
      id: 'scanType',
      label: '扫描类型',
      type: 'select',
      value: 'sS',
      options: [
        { label: 'SYN 半开扫描（推荐，快且不建立完整连接）', value: 'sS' },
        { label: 'Connect 全连接扫描（无需 root，较慢）', value: 'sT' },
        { label: 'UDP 扫描（慢，覆盖 5.3-5 UPnP/SSDP UDP 端口时选）', value: 'sU' },
      ],
      description:
        'SYN 扫描需要 root / 管理员权限，如无权限可切换为 Connect，但检测完整性略差。',
    },
    {
      id: 'timeoutMs',
      label: '扫描超时（毫秒）',
      type: 'number',
      value: 300000,
      min: 60000,
      max: 3600000,
      description: '单步 nmap 执行的最长允许时间，超时后模组主动 kill 并标记 status=timeout。',
    },
    {
      id: 'includeServiceVersion',
      label: '包含服务版本探测',
      type: 'checkbox',
      value: true,
      description:
        '勾选后加 -sV 参数，识别端口上运行的具体服务名和版本号，用于 5.3-2/5.3-3 的精确判定；建议保持勾选。',
    },
  ],
  clauses: [
    { clauseId: '5.3-1', title: '不必要网络服务必须禁用', severity: 'middle' },
    { clauseId: '5.3-2', title: '明文管理协议 Telnet/HTTP 不得开放', severity: 'high' },
    { clauseId: '5.3-3', title: '必须使用加密管理协议 SSH/HTTPS', severity: 'middle' },
    { clauseId: '5.3-5', title: 'UPnP/SSDP/MDNS 不得对外网暴露', severity: 'middle' },
  ],
};

export default config;
