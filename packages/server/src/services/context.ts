import { EventEmitter } from 'node:events';
import type { Repositories } from '../repositories/index.js';
import type { ExecutionEngine } from '../engine/executionEngine.js';
import type { ModuleLoader } from '../engine/moduleLoader.js';

export interface ServiceContext {
  repos: Repositories;
  engine: ExecutionEngine;
  moduleLoader: ModuleLoader;
  bus: EventEmitter;
  userId: string;
}

export const BUS_EVENTS = {
  RUN_LOG_LINE: 'run:logLine',
  RUN_PROGRESS: 'run:progress',
  RUN_STATUS: 'run:status',
  RUN_BATCH_PROGRESS: 'run:batchProgress',
  TOOL_HEALTH_UPDATED: 'tool:health',
} as const;
