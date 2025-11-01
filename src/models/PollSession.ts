import type { Poll } from "./Poll"

export interface PollSession<T> extends Poll<T> {
    optionVoteCounts: Map<string, number>;
}