export * from "./auth";
export * from "./focuslayer";

import {
	accounts,
	accountsRelations,
	sessions,
	sessionsRelations,
	users,
	usersRelations,
	verifications,
} from "./auth";
import {
	documents,
	documentsRelations,
	projects,
	projectsRelations,
	tasks,
	tasksRelations,
} from "./focuslayer";

export const schema = {
	users,
	sessions,
	accounts,
	verifications,
	documents,
	projects,
	tasks,
	usersRelations,
	sessionsRelations,
	accountsRelations,
	documentsRelations,
	projectsRelations,
	tasksRelations,
};
