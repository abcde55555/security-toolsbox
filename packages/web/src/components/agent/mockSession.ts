import type { AgentSession, Artifact } from '@en18031/shared';
import type { VerdictDraft } from '../../api/endpoints';

/**
 * TEMPORARY mock data for the Agent session UI while the backend is under
 * parallel development. Lets AgentSessionDetail render a full timeline
 * (phase bar, streaming tool output, human step, review panel, artifacts)
 * without a live socket/API.
 *
 * TODO(agent-backend): remove once POST /agent/sessions + the agent socket
 * room `agent:${sessionId}` are available end-to-end.
 */
export const MOCK_SESSION: AgentSession = {
  id: 'mock-session-0001',
  projectId: 'mock-project',
  deviceProfile: { brand: 'Little Genius', model: 'Z6s', platform: 'Spreadtrum UIS8540E', firmware: '2.0.3' },
  selectedClauses: ['GEC-1', 'GEC-2', 'GEC-4', 'SUM-1'],
  authorizedTools: ['nmap', 'tcpdump', 'binwalk'],
  phase: 'collection',
  status: 'running',
  planningModel: 'deepseek-v4-pro',
  narrativeModel: 'deepseek-v4-flash',
  currentStepId: 'human-1',
  rollbackCount: 0,
  createdBy: 'local-admin',
  createdAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
  updatedAt: new Date().toISOString(),
};

export const MOCK_ARTIFACTS: Artifact[] = [
  {
    id: 'art-1',
    projectId: 'mock-project',
    agentSessionId: 'mock-session-0001',
    type: 'device_profile',
    title: '设备档案',
    content: '品牌 Little Genius，型号 Z6s，展锐平台，固件 2.0.3，接入 Wi-Fi 调试。',
    fileRefs: [],
    createdBy: 'agent',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'art-2',
    projectId: 'mock-project',
    agentSessionId: 'mock-session-0001',
    type: 'network_topology',
    title: '网络拓扑',
    content: '设备 192.168.1.42，开放 8080/TCP（调试口）、5555/TCP（ADB）。',
    fileRefs: [],
    functionModule: 'network',
    createdBy: 'agent',
    createdAt: new Date().toISOString(),
  },
];

export const MOCK_VERDICTS: VerdictDraft[] = [
  {
    id: 'v-1',
    clauseId: 'GEC-1',
    pass: true,
    severity: 'high',
    reason: '调试端口在未认证状态下不暴露敏感服务，符合通用外部接口访问控制要求。',
    evidenceRefs: ['evidence/nmap-grec1.txt'],
    reviewStatus: 'pending_review',
    aiGenerated: true,
  },
  {
    id: 'v-2',
    clauseId: 'GEC-2',
    pass: false,
    severity: 'high',
    reason: '8080 端口存在未鉴权的固件下载接口，可直接获取固件镜像，判定不通过。',
    evidenceRefs: ['evidence/firmware-dump.bin', 'evidence/port-8080.png'],
    reviewStatus: 'pending_review',
    aiGenerated: true,
  },
];
