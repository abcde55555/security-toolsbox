import CommandRunList from '../CommandRunList';

interface CommandRunsTabProps {
  projectId: string;
  version: number;
}

export default function CommandRunsTab({ projectId, version }: CommandRunsTabProps) {
  return <CommandRunList key={`cmdruns-${version}`} projectId={projectId} />;
}
