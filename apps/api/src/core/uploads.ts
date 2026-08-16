/**
 * THE upload size ceiling — every document and image the platform accepts.
 *
 * ── Why one number ─────────────────────────────────────────────────────────
 * This used to be eight numbers in six files, and they had already drifted: the
 * API allowed a 10 MB experience certificate, the contract documented 5 MB, and
 * the web form advertised 5 MB while the profile page said 10. Whichever the
 * candidate believed, one of the three was lying to them. A single exported
 * constant is the only arrangement where the DTO, the storage gate, the OpenAPI
 * description and the UI hint cannot disagree.
 *
 * ── Why 2 MB ───────────────────────────────────────────────────────────────
 * The audience uploads from cheap Android phones on metered mobile data, often
 * pre-paid. A 10 MB passport scan is a meaningful amount of somebody's money and
 * a long wait on a weak connection, and it buys nothing: a phone photo of a
 * passport page or a PDF certificate is comfortably under 2 MB. The ceiling is a
 * cost and reliability decision for the user, not a storage decision for us.
 *
 * NOT applied to the working video (`candidates.video_max_mb`, a Setting). A
 * video is neither a document nor an image, 2 MB of video is a few seconds, and
 * the feature is MVP-blocked anyway — capping it here would be meaningless.
 */
export const MAX_UPLOAD_MB = 2;

export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
