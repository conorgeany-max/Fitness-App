import { Component, type ReactNode } from 'react';
import { Button, Callout } from './ui';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-xl py-10">
        <Callout tone="bad" title="Something went wrong on this screen" action={<Button onClick={() => this.setState({ error: null })}>Try again</Button>}>
          Your data is safe on this device. The error was: {this.state.error.message}
        </Callout>
      </div>
    );
  }
}
