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

    // URL to the screenshot or evidence provided
    screenshotUrl: string;

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
}