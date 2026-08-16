CREATE TABLE `analytics_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`week_no` integer NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_class_week_uq` ON `analytics_snapshots` (`class_id`,`week_no`);--> statement-breakpoint
CREATE TABLE `assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`language` text NOT NULL,
	`func_name` text NOT NULL,
	`knowledge_points` text NOT NULL,
	`cases` text NOT NULL,
	`starter_code` text NOT NULL,
	`limit_ms` integer NOT NULL,
	`week_no` integer NOT NULL,
	`due_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assignments_class_idx` ON `assignments` (`class_id`);--> statement-breakpoint
CREATE TABLE `classes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`semester` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `diagnoses` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`assignment_id` text NOT NULL,
	`stuck_points` text NOT NULL,
	`conclusion` text NOT NULL,
	`evolution` text NOT NULL,
	`evidence` text NOT NULL,
	`stuck_minutes` integer NOT NULL,
	`same_error_count` integer NOT NULL,
	`engine` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diagnoses_student_assignment_idx` ON `diagnoses` (`student_id`,`assignment_id`);--> statement-breakpoint
CREATE TABLE `evidence_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`suspicion` text NOT NULL,
	`signals` text NOT NULL,
	`note` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `evidence_student_idx` ON `evidence_signals` (`student_id`);--> statement-breakpoint
CREATE TABLE `guidance_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`assignment_id` text NOT NULL,
	`diagnosis_id` text,
	`level` integer NOT NULL,
	`status` text NOT NULL,
	`messages` text NOT NULL,
	`summary` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`diagnosis_id`) REFERENCES `diagnoses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sessions_student_assignment_idx` ON `guidance_sessions` (`student_id`,`assignment_id`);--> statement-breakpoint
CREATE TABLE `interventions` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`assignment_id` text NOT NULL,
	`trigger` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `interventions_student_idx` ON `interventions` (`student_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`class_id` text NOT NULL,
	`student_no` text NOT NULL,
	`anon_no` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_user_uq` ON `students` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `students_no_uq` ON `students` (`class_id`,`student_no`);--> statement-breakpoint
CREATE TABLE `submission_events` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`assignment_id` text NOT NULL,
	`submission_id` text,
	`seq` integer NOT NULL,
	`event_type` text NOT NULL,
	`detail` text NOT NULL,
	`interval_ms` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_student_assignment_idx` ON `submission_events` (`student_id`,`assignment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_seq_uq` ON `submission_events` (`student_id`,`assignment_id`,`seq`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`assignment_id` text NOT NULL,
	`seq` integer NOT NULL,
	`code` text NOT NULL,
	`language` text NOT NULL,
	`status` text NOT NULL,
	`score` integer NOT NULL,
	`pass_count` integer NOT NULL,
	`total_count` integer NOT NULL,
	`detail` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `submissions_student_assignment_idx` ON `submissions` (`student_id`,`assignment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_seq_uq` ON `submissions` (`student_id`,`assignment_id`,`seq`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_uq` ON `users` (`username`);