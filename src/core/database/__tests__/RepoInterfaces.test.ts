import { describe, it, expect, beforeAll } from "vitest";

let TaskRepository: any;
let MovieRepository: any;
let PrizeDrawRepository: any;

beforeAll(async () => {
    // Dynamically import after global Firestore mock from setup.ts is applied
    TaskRepository = (await import("../TaskRepo.js")).TaskRepository;
    MovieRepository = (await import("../MovieRepo.js")).MovieRepository;
    PrizeDrawRepository = (await import("../PrizeDrawRepo.js")).PrizeDrawRepository;
});


function expectPromise(fnResult: unknown, message: string) {
    expect(typeof (fnResult as Promise<unknown>).then).toBe('function');
}

describe('Repository interface contracts', () => {
    it('TaskRepository implements the task repo contract', async () => {
        const repo = new TaskRepository('guild-test');

        const mockTaskPoll = { id: 'test-poll-id', name: 'Test Poll' };
        const mockTaskEvent = { id: 'test-event-id', name: 'Test Event' };
        const mockSubmission = { id: 'test-submission-id', content: 'Test Submission' };
        const mockFeedback = { id: 'test-feedback-id', message: 'Test Feedback' };

        expectPromise(repo.getAllTasks(), 'getAllTasks');
        expectPromise(repo.getTaskById('id'), 'getTaskById');
        expectPromise(repo.getTasksByCategory('cat'), 'getTasksByCategory');
        expectPromise(repo.getRandomTasks(), 'getRandomTasks');
        expectPromise(repo.incrementWeight('id'), 'incrementWeight');

        expectPromise(repo.createTaskPoll(mockTaskPoll), 'createTaskPoll');
        expectPromise(repo.getActiveTaskPollByCategory(), 'getActiveTaskPollByCategory');
        expectPromise(repo.closeTaskPoll('poll'), 'closeTaskPoll');
        expectPromise(repo.clearTaskPolls(), 'clearTaskPolls');

        expectPromise(repo.createTaskEvent(mockTaskEvent), 'createTaskEvent');
        expectPromise(repo.getLatestTaskEvent(), 'getLatestTaskEvent');
        expectPromise(repo.getTaskEventById('event'), 'getTaskEventById');
        expectPromise(repo.getTaskEventsBetween(new Date(), new Date()), 'getTaskEventsBetween');

        expectPromise(repo.createSubmission(mockSubmission), 'createSubmission');
        expectPromise(repo.getSubmissionById('submission'), 'getSubmissionById');
        expectPromise(repo.getSubmissionsForTask('task'), 'getSubmissionsForTask');
        expectPromise(repo.getSubmissionsByUser('user'), 'getSubmissionsByUser');
        expectPromise(repo.updateSubmissionStatus('id', 'Pending', 'reviewer'), 'updateSubmissionStatus');

        expectPromise(repo.addFeedback(mockFeedback), 'addFeedback');
        expectPromise(repo.getFeedbackForTask('task'), 'getFeedbackForTask');

        expectPromise(repo.deleteAllTasks(), 'deleteAllTasks');
        expectPromise(repo.seedTasks([]), 'seedTasks');
    });

    it('MovieRepository implements the movie repo contract', async () => {
        const repo = new MovieRepository('guild-test');

        const mockMovie = { id: 'test-movie-id', title: 'Test Movie' };
        const mockPoll = { id: 'test-poll-id', name: 'Test Poll' };
        const mockEvent = { id: 'test-event-id', name: 'Test Event' };

        expectPromise(repo.getAllMovies(), 'getAllMovies');
        expectPromise(repo.getMovieById('id'), 'getMovieById');
        expectPromise(repo.upsertMovie(mockMovie), 'upsertMovie');
        expectPromise(repo.deleteMovie('id'), 'deleteMovie');

        expectPromise(repo.createPoll(mockPoll), 'createPoll');
        expectPromise(repo.getActivePoll(), 'getActivePoll');
        expectPromise(repo.closePoll('poll'), 'closePoll');
        expectPromise(repo.clearPolls(), 'clearPolls');

        expectPromise(repo.createMovieEvent(mockEvent), 'createMovieEvent');
        expectPromise(repo.getActiveEvent(), 'getActiveEvent');
        expectPromise(repo.getLatestEvent(), 'getLatestEvent');
        expectPromise(repo.getAllEvents(), 'getAllEvents');
        expectPromise(repo.clearEvents(), 'clearEvents');
    });

    it('PrizeDrawRepository implements the prize repo contract', async () => {
        const repo = new PrizeDrawRepository('guild-test');

        const mockPrizeDraw = { id: 'test-draw-id', name: 'Test Draw', participants: [] };

        expectPromise(repo.createPrizeDraw(mockPrizeDraw), 'createPrizeDraw');
        expectPromise(repo.getAllPrizeDraws(), 'getAllPrizeDraws');
        expectPromise(repo.getPrizeDrawById('id'), 'getPrizeDrawById');
        expectPromise(repo.updateParticipants('id', {}), 'updateParticipants');
        expectPromise(repo.addEntry('id', 'user'), 'addEntry');
        expectPromise(repo.setWinners('id', {} as any), 'setWinners');
        expectPromise(repo.deletePrizeDraw('id'), 'deletePrizeDraw');
        expectPromise(repo.clearPrizeDraws(), 'clearPrizeDraws');
    });
});
