/** Bounded authoring history; individual file and count guards still apply. */
export const MAX_REVIEW_FILES = 1000;
export const MAX_REVIEW_BYTES = 256 * 1024 * 1024;

export const MAX_REVIEW_CONTAINER_BYTES = MAX_REVIEW_BYTES + 1024 * 1024;
