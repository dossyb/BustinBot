import type { Poll } from "./Poll.js"

export interface PollSession<T> extends Poll<T> {
    optionVoteCounts: Map<string, number>;
}