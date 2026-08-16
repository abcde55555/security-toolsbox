import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Result, Button } from 'antd';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  remountKey: number;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, remountKey: 0 };

  static getDerivedStateFromError(error: Error): Pick<State, 'error'> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  reset = (): void => {
    this.setState((s) => ({ error: null, remountKey: s.remountKey + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <Result
          status="error"
          title="页面发生错误"
          subTitle={this.state.error.message || '未知错误'}
          extra={[
            <Button key="retry" type="primary" onClick={this.reset}>重试</Button>,
            <Button key="reload" onClick={() => window.location.reload()}>刷新页面</Button>,
          ]}
        />
      );
    }
    return <div key={this.state.remountKey}>{this.props.children}</div>;
  }
}
