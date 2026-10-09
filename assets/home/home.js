/* ============================================================
   HOME PAGE
   Marks a daily challenge card done once today's is finished, with the
   result. Reads the saved dailies through top10-records.js.
   ============================================================ */

function markHomeCard(card, result) {
    if (!card) return;
    // Keep the card's own wording, to put back after midnight
    card.dataset.original ??= card.innerHTML;
    card.classList.toggle("done", !!result);
    if (!result) {
        card.innerHTML = card.dataset.original;
        return;
    }
    card.querySelector(".feature-tag").textContent = "✓ Done today";
    card.querySelector(".feature-desc").textContent = result;
    card.querySelector(".feature-cta").innerHTML = `See your result <span aria-hidden="true">→</span>`;
}

function markHomeCards() {
    const results = todaysDailyResults();
    markHomeCard(document.getElementById("missingCard"), results.missing);
    markHomeCard(document.getElementById("shelfCard"), results.shelf);
}

document.addEventListener("DOMContentLoaded", markHomeCards);

// The installed app resumes this page rather than reloading it, so check
// again on the way back from a daily
window.addEventListener("pageshow", markHomeCards);
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") markHomeCards();
});
