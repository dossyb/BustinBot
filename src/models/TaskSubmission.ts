export enum SubmissionStatus {
    Pending = 'Pending',
    Approved = 'Approved',
    Rejected = 'Rejected',
}

export interface TaskSubmission {
    // Unique identifier for the submission
    id: string;

    // ID of the user who made the submission
    userId: string;

    // ID for the associated task event
    taskEventId: string;

    // URLs to the screenshot or evidence provided
    screenshotUrls: string[];

    // Optional submission notes
    notes?: string;
    
    // Current status of the submission
    status: SubmissionStatus;

    // Admin who reviewed the submission (if applicable)
    reviewedBy?: string;

    // Timestamp when the submission was created
    createdAt: Date;

    // Timestamp when the submission was reviewed
    reviewedAt?: Date;

    // Reason for rejection (if applicable)
    rejectionReason?: string;

    // Optional storage of message ID in admin verification channel
    message?: string;

    // Optional storage of screenshot message ID in admin verification channel
    screenshotMessage?: string;

    // Flag if submission is a duplicate of one already approved
    alreadyApproved?: boolean;

    // Human-friendly task name at time of submission
    taskName?: string;
}