import { describe, it, expect } from 'vitest';
import { createInMemoryRepositories } from '../repositories/index.js';
import './helpers.js';

describe('AgentRepository', () => {
  it('createEvent assigns monotonically increasing seq per session and is replayable', () => {
    const { repos, close } = createInMemoryRepositories();
    const session = repos.agent.createSession({ projectId: 'proj-1', createdBy: 'tester' });

    const e1 = repos.agent.createEvent({ sessionId: session.id, type: 'phase_change', content: 'start' });
    const e2 = repos.agent.createEvent({ sessionId: session.id, type: 'tool_call', toolName: 'list_clauses' });
    const e3 = repos.agent.createEvent({ sessionId: session.id, type: 'model_message', content: 'hi' });

    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(e3.seq).toBe(3);

    // seq is independent across sessions
    const other = repos.agent.createSession({ projectId: 'proj-1', createdBy: 'tester' });
    const oe1 = repos.agent.createEvent({ sessionId: other.id, type: 'phase_change' });
    expect(oe1.seq).toBe(1);

    // replay from the beginning and since a cursor
    const all = repos.agent.listEvents(session.id);
    expect(all.map((e) => e.seq)).toEqual([1, 2, 3]);
    const tail = repos.agent.listEvents(session.id, 1);
    expect(tail.map((e) => e.seq)).toEqual([2, 3]);
    expect(tail[0].toolName).toBe('list_clauses');
    close();
  });

  it('agent_events is append-only: UPDATE and DELETE are rejected', () => {
    const { repos, close } = createInMemoryRepositories();
    const session = repos.agent.createSession({ projectId: 'proj-1', createdBy: 'tester' });
    const ev = repos.agent.createEvent({ sessionId: session.id, type: 'phase_change', content: 'x' });

    // Reach the underlying better-sqlite3 handle to attempt a raw mutation.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (repos.agent as any).db as import('better-sqlite3').Database;

    expect(() => db.prepare('UPDATE agent_events SET content=? WHERE id=?').run('tampered', ev.id)).toThrow(
      /append-only/,
    );
    expect(() => db.prepare('DELETE FROM agent_events WHERE id=?').run(ev.id)).toThrow(/append-only/);

    // original content intact
    expect(repos.agent.listEvents(session.id)[0].content).toBe('x');
    close();
  });
});
