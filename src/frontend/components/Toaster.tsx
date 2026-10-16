import { action, makeObservable, observable } from 'mobx';
import { generateWidgetId } from 'widgets/utility';
import { ID } from '../../api/id';

/**
 * The messages of the app: shown one above the other in the status footer at the bottom left, never
 * anywhere else. A message with a `timeout` goes after that long; one without (0) is work going on, and
 * stays until it is replaced (same `id`) or dismissed.
 */
class ToastManager {
  readonly toastList = observable(new Array<Toast>());
  private timeouts = new Map<ID, number>();

  constructor() {
    makeObservable(this);
  }

  @action show(toast: IToastProps, id?: ID): ID {
    if (id !== undefined) {
      const existing = this.toastList.findIndex((t) => t.id === id);
      if (existing !== -1) {
        this.toastList[existing] = { ...toast, id };
        let timerId = this.timeouts.get(id);
        window.clearTimeout(timerId);
        if (toast.timeout > 0) {
          timerId = window.setTimeout(() => this.dismiss(id), toast.timeout);
          this.timeouts.set(id, timerId);
        }
        return id;
      }
    }

    const toastWithKey: Toast = {
      ...toast,
      id: id ?? generateWidgetId('__toast'),
    };
    this.toastList.push(toastWithKey);
    if (toast.timeout > 0) {
      const timerId = window.setTimeout(() => this.dismiss(toastWithKey.id), toast.timeout);
      this.timeouts.set(toastWithKey.id, timerId);
    }
    return toastWithKey.id;
  }

  @action dismiss(id: string): boolean {
    // Its timer goes too: else it would take away a new message of the same id before its time
    window.clearTimeout(this.timeouts.get(id));
    this.timeouts.delete(id);
    const instance = this.toastList.find((t) => t.id === id);
    if (instance !== undefined) {
      return this.toastList.remove(instance);
    }
    return false;
  }
}

// Create a singleton toaster - we should only be needing one
export const AppToaster = new ToastManager();

interface IToastProps {
  message: string;
  // "action" apparently is a reserverd keyword, it gets removed by mobx...
  clickAction?: {
    label: string;
    onClick: () => void;
  };
  timeout: number;
}

/** A message, as the status footer shows it (`StatusFooter.tsx`) */
export type Toast = IToastProps & { id: ID };
