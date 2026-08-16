import type { Tool, ToolCommand } from '@en18031/shared';
import type { Repositories } from '../repositories/index.js';
import { logger } from '../logger.js';
import { CommandExecutor } from '../engine/commandExecutor.js';

interface SeedTool {
  id: string;
  name: string;
  description: string;
  tags: string[];
  category: Tool['category'];
  healthCheck?: { command: string; timeoutMs: number };
  commands: ToolCommand[];
}

const netCommands: ToolCommand[] = [
  {
    id: 'ping',
    name: 'Ping 连通性',
    description: '向目标发送 ICMP 回显请求，验证网络可达性与延迟。',
    commandTemplate: 'ping -c {{count}} {{target}}',
    outputTips:
      '关键看 "X packets transmitted, Y received"：0% packet loss 表示连通；出现 "Request timeout" 或 100% loss 表示不可达。',
    timeoutMs: 30_000,
    params: [
      {
        id: 'count',
        label: '发送次数',
        type: 'number',
        required: true,
        value: 1,
        min: 1,
        max: 20,
      },
      {
        id: 'target',
        label: '目标地址',
        type: 'text',
        required: true,
        value: '127.0.0.1',
        placeholder: 'IP 或主机名',
      },
    ],
  },
  {
    id: 'nc-port',
    name: 'TCP 端口探测',
    description: '使用 nc 探测目标主机的 TCP 端口是否开放。',
    commandTemplate: 'nc -vz -w {{timeoutSec}} {{target}} {{port}}',
    outputTips: '看到 "succeeded!" / "open" 表示端口开放；"timed out" / "refused" 表示不可达。',
    timeoutMs: 15_000,
    params: [
      {
        id: 'timeoutSec',
        label: '超时(秒)',
        type: 'number',
        required: true,
        value: 3,
        min: 1,
        max: 60,
      },
      {
        id: 'target',
        label: '目标地址',
        type: 'text',
        required: true,
        value: '127.0.0.1',
      },
      {
        id: 'port',
        label: '端口',
        type: 'number',
        required: true,
        value: 22,
        min: 1,
        max: 65535,
      },
    ],
  },
  {
    id: 'nslookup',
    name: 'DNS 解析',
    description: '查询域名对应的 DNS 记录。',
    commandTemplate: 'nslookup {{domain}}',
    outputTips: '关注 "Address:" 返回的解析结果；"server can\'t find" 表示解析失败。',
    timeoutMs: 10_000,
    params: [
      {
        id: 'domain',
        label: '域名',
        type: 'text',
        required: true,
        value: 'example.com',
      },
    ],
  },
  {
    id: 'route',
    name: '路由表',
    description: '查看系统路由表（前 20 行）。',
    commandTemplate: 'netstat -rn | head -20',
    outputTips: '确认默认网关 (default/0.0.0.0) 与接口路由是否正确。',
    timeoutMs: 5_000,
    params: [],
  },
];

const bluetoothCommands: ToolCommand[] = [
  {
    id: 'hciconfig',
    name: '蓝牙适配器信息',
    description: '列出本机蓝牙适配器及状态。',
    commandTemplate: 'hciconfig -a',
    outputTips: 'UP/RUNNING 表示适配器已启用；未找到命令说明未安装 bluez。',
    timeoutMs: 5_000,
    platforms: ['linux'],
    params: [],
  },
  {
    id: 'hcitool-scan',
    name: '经典蓝牙扫描',
    description: '扫描周边经典蓝牙 (BR/EDR) 设备。',
    commandTemplate: 'hcitool -i {{hciDev}} scan --length={{duration}}',
    outputTips: '输出 MAC 地址与设备名；扫描时长越长发现设备越多。需要 root。',
    timeoutMs: 70_000,
    requiresRoot: true,
    platforms: ['linux'],
    params: [
      {
        id: 'hciDev',
        label: '适配器',
        type: 'select',
        required: true,
        value: 'hci0',
        options: ['hci0', 'hci1'],
      },
      {
        id: 'duration',
        label: '扫描时长(秒)',
        type: 'number',
        required: true,
        value: 8,
        min: 1,
        max: 60,
      },
    ],
  },
  {
    id: 'hcitool-lescan',
    name: 'BLE 低功耗扫描',
    description: '扫描周边 BLE 低功耗蓝牙设备。',
    commandTemplate: 'timeout {{duration}} hcitool -i {{hciDev}} lescan',
    outputTips: '持续输出 BLE 设备 MAC；重复出现表示可连接的广播设备。需要 root。',
    timeoutMs: 70_000,
    requiresRoot: true,
    platforms: ['linux'],
    params: [
      {
        id: 'duration',
        label: '扫描时长(秒)',
        type: 'number',
        required: true,
        value: 8,
        min: 1,
        max: 60,
      },
      {
        id: 'hciDev',
        label: '适配器',
        type: 'select',
        required: true,
        value: 'hci0',
        options: ['hci0', 'hci1'],
      },
    ],
  },
  {
    id: 'l2ping',
    name: '蓝牙链路连通性',
    description: '向蓝牙设备发送 L2CAP ping，验证链路层可达性。',
    commandTemplate: 'l2ping -c {{count}} -i {{hciDev}} {{btAddr}}',
    outputTips: '看到 "X bytes from ..." 表示链路可达；"Can not connect" 表示设备不可达。',
    timeoutMs: 15_000,
    platforms: ['linux'],
    relatedClauses: ['5.3-2'],
    params: [
      {
        id: 'count',
        label: '发送次数',
        type: 'number',
        required: true,
        value: 3,
        min: 1,
        max: 20,
      },
      {
        id: 'hciDev',
        label: '适配器',
        type: 'select',
        required: true,
        value: 'hci0',
        options: ['hci0', 'hci1'],
      },
      {
        id: 'btAddr',
        label: '蓝牙 MAC 地址',
        type: 'text',
        required: true,
        placeholder: 'AA:BB:CC:DD:EE:FF',
        regex: '^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$',
      },
    ],
  },
  {
    id: 'sdptool',
    name: 'SDP 服务浏览',
    description: '浏览远端蓝牙设备提供的 SDP 服务记录。',
    commandTemplate: 'sdptool browse {{btAddr}}',
    outputTips: '列出设备支持的服务 (A2DP/HID/SPP 等)，用于评估服务暴露面。',
    timeoutMs: 20_000,
    platforms: ['linux'],
    relatedClauses: ['5.3-2'],
    params: [
      {
        id: 'btAddr',
        label: '蓝牙 MAC 地址',
        type: 'text',
        required: true,
        placeholder: 'AA:BB:CC:DD:EE:FF',
        regex: '^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$',
      },
    ],
  },
];

const SEED_TOOLS: SeedTool[] = [
  {
    id: 'demo-net-connectivity',
    name: '网络连通性工具箱',
    description: '内置 ping / 端口探测 / DNS / 路由表等常用网络诊断命令，开箱即用。',
    tags: ['demo', 'network', 'ping', 'dns'],
    category: 'network-compliance',
    healthCheck: { command: 'ping -c 1 127.0.0.1', timeoutMs: 5000 },
    commands: netCommands,
  },
  {
    id: 'demo-bluetooth-toolkit',
    name: '蓝牙检测工具包',
    description: '蓝牙适配器状态、经典/BLE 扫描、链路连通性与 SDP 服务浏览（仅 Linux/bluez）。',
    tags: ['demo', 'bluetooth', 'ble'],
    category: 'network-compliance',
    commands: bluetoothCommands,
  },
];

export async function seedCommandTools(repos: Repositories): Promise<void> {
  const executor = new CommandExecutor();
  for (const seed of SEED_TOOLS) {
    const existing = repos.tools.getById(seed.id, true);
    if (existing) continue;
    repos.tools.create({
      id: seed.id,
      workspaceId: 'default',
      name: seed.name,
      type: 'custom',
      interactionMode: 'cmd',
      version: '1.0.0',
      author: 'system',
      description: seed.description,
      tags: seed.tags,
      category: seed.category,
      healthCheck: seed.healthCheck,
      commands: seed.commands,
      formFields: [],
      clauses: [],
      builtin: false,
    });
    logger.info({ tool: seed.id, commands: seed.commands.length }, 'command-manual tool seeded');

    if (seed.healthCheck) {
      try {
        const result = await executor.runCommand(seed.healthCheck.command, {
          timeoutMs: seed.healthCheck.timeoutMs ?? 5000,
        });
        if (result.exitCode === 0) {
          repos.tools.setHealth(seed.id, 'green', (result.stdout + result.stderr).trim().slice(0, 500));
        } else {
          repos.tools.setHealth(seed.id, 'red', (result.stderr || result.stdout).slice(0, 500));
        }
      } catch (e) {
        repos.tools.setHealth(seed.id, 'red', (e as Error).message);
      }
    }
  }
}
