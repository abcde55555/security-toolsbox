import { useEffect, useReducer, useRef } from 'react';
import type { AgentSession } from '@en18031/shared';
import {
  reducer,
  initialState,
  buildTimeline,
  type AgentAction,
} from './useAgentSession';
import { MOCK_SESSION, MOCK_ARTIFACTS, MOCK_VERDICTS } from '../components/agent/mockSession';

/**
 * TEMPORARY: drives the session UI with scripted fake events so the full
 * page can be demonstrated before the backend socket exists. Activated from
 * AgentSessionDetail via ?mock=1 or session id "mock".
 *
 * TODO(agent-backend): delete once the real socket + APIs are live.
 */
export function useMockAgentSession(seed: AgentSession = MOCK_SESSION) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    dispatch({
      type: 'init',
      session: seed,
      events: [],
      artifacts: MOCK_ARTIFACTS,
      verdicts: MOCK_VERDICTS,
    });
    dispatch({ type: 'connected', connected: true });
    dispatch({ type: 'phase', from: 'onboarding', to: 'onboarding', seq: 1 });

    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));

    at(400, () => dispatch({ type: 'message', role: 'assistant', content: '已检索到 Z6s 相关 skill：先通过串口/Wi-Fi 完成设备接入，再采集开放端口与固件证据。', seq: 2 }));

    at(900, () => dispatch({
      type: 'human_requested',
      req: {
        stepRunId: 'human-1',
        stepType: 'human_instruction',
        phase: 'onboarding',
        title: '接入设备并确认调试通道',
        instruction:
          '请完成以下接入步骤：\n- 用 USB 连接手表并启用 **ADB 调试**\n- 确认设备获得 IP（设置→关于）\n- 在本机执行 `adb devices` 确认序列号\n- 截图设备“关于”页作为证据',
        expectedOutcome: 'adb devices 能列出设备，且已上传“关于”页截图。',
        referenceCommand: 'adb devices\nadb shell getprop ro.build.display.id',
        evidenceRequired: true,
        functionModule: 'device-interaction',
        status: 'running',
        completed: false,
      },
    }));

    at(2200, () => {
      dispatch({ type: 'human_completed', stepRunId: 'human-1', fileRefs: ['evidence/about.png'], outcome: '设备已接入，序列号 0123ABCDEF' });
      dispatch({ type: 'phase', from: 'onboarding', to: 'collection', seq: 3 });
      dispatch({ type: 'session', patch: { status: 'running', phase: 'collection' } });
    });

    // Streaming nmap tool call
    at(2600, () => dispatch({
      type: 'tool_call',
      ev: {
        id: 'ev-tc1', sessionId: seed.id, seq: 4, type: 'tool_call',
        toolName: 'nmap', toolArgs: { target: '192.168.1.42', ports: '1-10000' },
        toolStatus: 'running', stepRunId: 'step-nmap', createdAt: new Date().toISOString(),
        toolCallId: 'tc-nmap',
      } as any,
    }));
    const nmapLines = [
      'Starting Nmap 7.94 ( https://nmap.org )',
      'Nmap scan report for 192.168.1.42',
      'Host is up (0.042s latency).',
      'PORT     STATE SERVICE',
      '5555/tcp open  adb',
      '8080/tcp open  http-proxy',
      '8081/tcp open  blackice-icecap',
      'Nmap done: 1 IP address (1 host up) scanned in 3.21 seconds',
    ];
    nmapLines.forEach((line, i) => {
      at(2900 + i * 350, () => dispatch({
        type: 'tool_output',
        p: { stepRunId: 'step-nmap', toolCallId: 'tc-nmap', stream: 'stdout', chunk: line + '\n' },
      }));
    });
    at(2900 + nmapLines.length * 350 + 200, () => dispatch({
      type: 'tool_result',
      p: {
        stepRunId: 'step-nmap', toolCallId: 'tc-nmap', status: 'success', exitCode: 0,
        durationMs: 3210, evidenceRefs: ['evidence/nmap-grec1.txt'], artifactRefs: [],
      },
    }));

    // binwalk firmware analysis
    at(7000, () => dispatch({
      type: 'tool_call',
      ev: {
        id: 'ev-tc2', sessionId: seed.id, seq: 5, type: 'tool_call',
        toolName: 'binwalk', toolArgs: { file: 'firmware-dump.bin' },
        toolStatus: 'running', stepRunId: 'step-binwalk', createdAt: new Date().toISOString(),
        toolCallId: 'tc-binwalk',
      } as any,
    }));
    at(7300, () => dispatch({
      type: 'tool_output',
      p: { stepRunId: 'step-binwalk', toolCallId: 'tc-binwalk', stream: 'stdout', chunk: 'DECIMAL       HEXADECIMAL     DESCRIPTION\n' },
    }));
    at(7600, () => dispatch({
      type: 'tool_output',
      p: { stepRunId: 'step-binwalk', toolCallId: 'tc-binwalk', stream: 'stdout', chunk: '0             0x0             uImage header, CRC OK\n32768         0x8000          Squashfs filesystem\n' },
    }));
    at(8200, () => dispatch({
      type: 'tool_result',
      p: {
        stepRunId: 'step-binwalk', toolCallId: 'tc-binwalk', status: 'success', exitCode: 0,
        durationMs: 1180, evidenceRefs: ['evidence/firmware-dump.bin'], artifactRefs: [],
      },
    }));

    at(8800, () => dispatch({ type: 'phase', from: 'collection', to: 'adjudication', seq: 6 }));
    at(9100, () => dispatch({ type: 'message', role: 'assistant', content: '进入判定阶段，基于 nmap 与固件证据产出 GEC-1/GEC-2 待审核判定。', seq: 7 }));

    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [seed]);

  const timeline = buildTimeline(state);

  return {
    state,
    session: state.session,
    events: state.events,
    timeline,
    artifacts: state.artifacts,
    evidences: state.evidences,
    verdicts: state.verdicts,
    loading: state.loading,
    error: state.error,
    connected: state.connected,
    completeHumanStep: async (stepRunId: string, body: { outcome?: string; fileRefs: string[]; functionModule?: string; status?: string }) => {
      dispatch({ type: 'human_completed', stepRunId, fileRefs: body.fileRefs, outcome: body.outcome });
    },
    sendMessage: async (content: string) => dispatch({ type: 'message', role: 'user', content }),
    reviewVerdict: async (verdictId: string, action: 'approve' | 'reject' | 'request_evidence', reason?: string) => {
      const next = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'pending_review';
      dispatch({ type: 'verdict_updated', v: { id: verdictId, reviewStatus: next, reviewNote: reason } });
    },
    retryClause: async () => { /* no-op in mock */ },
    start: async () => dispatch({ type: 'session', patch: { status: 'running' } }),
    abort: async () => dispatch({ type: 'session', patch: { status: 'aborted' } }),
  };
}
