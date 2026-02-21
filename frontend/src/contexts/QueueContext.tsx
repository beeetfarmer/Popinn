import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { MusicVideo } from "@/data/mockData";

interface StartQueueOptions {
  startIndex?: number;
  shuffle?: boolean;
}

interface QueueState {
  queue: MusicVideo[];
  currentIndex: number;
}

interface QueueContextValue {
  queue: MusicVideo[];
  currentIndex: number;
  currentVideo: MusicVideo | null;
  hasPrevious: boolean;
  hasNext: boolean;
  startQueue: (videos: MusicVideo[], options?: StartQueueOptions) => void;
  clearQueue: () => void;
  setCurrentByVideoId: (videoId: string) => void;
  playNext: () => MusicVideo | null;
  playPrevious: () => MusicVideo | null;
  playAtIndex: (index: number) => MusicVideo | null;
  moveQueueItem: (fromIndex: number, toIndex: number) => void;
}

const QueueContext = createContext<QueueContextValue | null>(null);

function shuffleVideos(items: MusicVideo[]): MusicVideo[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function uniqueByVideoId(items: MusicVideo[]): MusicVideo[] {
  const seen = new Set<string>();
  const out: MusicVideo[] = [];
  items.forEach((video) => {
    if (seen.has(video.id)) return;
    seen.add(video.id);
    out.push(video);
  });
  return out;
}

export function QueueProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<QueueState>({
    queue: [],
    currentIndex: -1,
  });

  const startQueue = useCallback((videos: MusicVideo[], options?: StartQueueOptions) => {
    const deduped = uniqueByVideoId(videos);
    if (deduped.length === 0) {
      setState({ queue: [], currentIndex: -1 });
      return;
    }

    const maybeShuffled = options?.shuffle ? shuffleVideos(deduped) : deduped;
    const startIndex = Math.max(
      0,
      Math.min(options?.startIndex ?? 0, maybeShuffled.length - 1)
    );

    setState({
      queue: maybeShuffled,
      currentIndex: startIndex,
    });
  }, []);

  const clearQueue = useCallback(() => {
    setState({ queue: [], currentIndex: -1 });
  }, []);

  const setCurrentByVideoId = useCallback((videoId: string) => {
    setState((prev) => {
      const idx = prev.queue.findIndex((item) => item.id === videoId);
      if (idx < 0 || idx === prev.currentIndex) return prev;
      return { ...prev, currentIndex: idx };
    });
  }, []);

  const playAtIndex = useCallback((index: number) => {
    let selected: MusicVideo | null = null;
    setState((prev) => {
      if (index < 0 || index >= prev.queue.length) return prev;
      selected = prev.queue[index];
      return { ...prev, currentIndex: index };
    });
    return selected;
  }, []);

  const playNext = useCallback(() => {
    let selected: MusicVideo | null = null;
    setState((prev) => {
      const nextIndex = prev.currentIndex + 1;
      if (nextIndex < 0 || nextIndex >= prev.queue.length) return prev;
      selected = prev.queue[nextIndex];
      return { ...prev, currentIndex: nextIndex };
    });
    return selected;
  }, []);

  const playPrevious = useCallback(() => {
    let selected: MusicVideo | null = null;
    setState((prev) => {
      const previousIndex = prev.currentIndex - 1;
      if (previousIndex < 0 || previousIndex >= prev.queue.length) return prev;
      selected = prev.queue[previousIndex];
      return { ...prev, currentIndex: previousIndex };
    });
    return selected;
  }, []);

  const moveQueueItem = useCallback((fromIndex: number, toIndex: number) => {
    setState((prev) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.queue.length ||
        toIndex >= prev.queue.length ||
        fromIndex === toIndex
      ) {
        return prev;
      }

      const currentId = prev.queue[prev.currentIndex]?.id;
      const nextQueue = [...prev.queue];
      const [moved] = nextQueue.splice(fromIndex, 1);
      nextQueue.splice(toIndex, 0, moved);
      const nextCurrentIndex = currentId
        ? nextQueue.findIndex((video) => video.id === currentId)
        : prev.currentIndex;

      return {
        queue: nextQueue,
        currentIndex: nextCurrentIndex,
      };
    });
  }, []);

  const value = useMemo<QueueContextValue>(() => {
    const currentVideo =
      state.currentIndex >= 0 ? state.queue[state.currentIndex] || null : null;

    return {
      queue: state.queue,
      currentIndex: state.currentIndex,
      currentVideo,
      hasPrevious: state.currentIndex > 0,
      hasNext:
        state.currentIndex >= 0 && state.currentIndex < state.queue.length - 1,
      startQueue,
      clearQueue,
      setCurrentByVideoId,
      playNext,
      playPrevious,
      playAtIndex,
      moveQueueItem,
    };
  }, [
    state.queue,
    state.currentIndex,
    startQueue,
    clearQueue,
    setCurrentByVideoId,
    playNext,
    playPrevious,
    playAtIndex,
    moveQueueItem,
  ]);

  return (
    <QueueContext.Provider value={value}>
      {children}
    </QueueContext.Provider>
  );
}

export function useQueue() {
  const ctx = useContext(QueueContext);
  if (!ctx) {
    throw new Error("useQueue must be used within a QueueProvider");
  }
  return ctx;
}
