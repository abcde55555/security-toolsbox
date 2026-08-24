import { EventEmitter } from 'node:events';
import { getRepositories } from '../repositories/index.js';
import { ExecutionEngine } from '../engine/executionEngine.js';
import { ModuleLoader } from '../engine/moduleLoader.js';
import { config } from '../config.js';
import { AuthzService } from './authzService.js';
import { ToolRegistryService } from './toolRegistryService.js';
import { TemplateService } from './templateService.js';
import { ProjectService } from './projectService.js';
import { OrchestratorService } from './orchestratorService.js';
import { ClauseMappingService } from './clauseMappingService.js';
import { ReportService, setReportService } from './reportService.js';
import { CommandRunnerService } from './commandRunnerService.js';
import { AgentService } from '../agent/agentService.js';
import type { ServiceContext } from './context.js';
import type { Repositories } from '../repositories/index.js';

export interface Services {
  repos: Repositories;
  authz: AuthzService;
  tools: ToolRegistryService;
  templates: TemplateService;
  projects: ProjectService;
  orchestrator: OrchestratorService;
  clauses: ClauseMappingService;
  reports: ReportService;
  commandRunner: CommandRunnerService;
  agent: AgentService;
  engine: ExecutionEngine;
  moduleLoader: ModuleLoader;
  bus: EventEmitter;
}

let services: Services | null = null;

export function getServices(): Services {
  if (services) return services;
  const repos = getRepositories();
  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  const moduleLoader = new ModuleLoader();
  const engine = new ExecutionEngine(moduleLoader);
  const ctx: ServiceContext = {
    repos,
    engine,
    moduleLoader,
    bus,
    userId: 'local-admin',
  };
  const authz = new AuthzService();
  const tools = new ToolRegistryService(ctx);
  const templates = new TemplateService(ctx);
  const projects = new ProjectService(ctx);
  const clauses = new ClauseMappingService(ctx);
  const reports = new ReportService(ctx);
  setReportService(reports);
  const orchestrator = new OrchestratorService(ctx);
  const commandRunner = new CommandRunnerService(ctx);
  const agent = new AgentService(repos, engine, moduleLoader, bus);

  services = {
    repos,
    authz,
    tools,
    templates,
    projects,
    orchestrator,
    clauses,
    reports,
    commandRunner,
    agent,
    engine,
    moduleLoader,
    bus,
  };
  return services;
}

export async function initServices(): Promise<Services> {
  const s = getServices();
  await s.moduleLoader.loadBuiltins();
  return s;
}

export { config };
