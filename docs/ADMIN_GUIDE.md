# Administrator operations guide

Everything below works on a phone. Log in at **`/admin/login`**. The tabs are **Overview · Election · Candidates · Students · Audit**.

> Voting can't be reopened and votes can't be undone. Do a practice run on a separate test deployment first.

## Before voting (status: Not started)

### 1. Configure candidates
**Candidates** tab:
- **Add a candidate:** enter a name (and optionally a description such as department and year), then tap **Add candidate**.
- **Edit or Delete** using the buttons next to each candidate.
- **Import a CSV:** tap **Download template**, fill it in (`name,description`, keeping the header row), choose the file, then tap **Import candidates**.
  Tick **Replace all existing candidates** to swap out the whole list. If any row has a problem, nothing is imported and every bad line is listed.

### 2. Set maximum selections
**Election** tab:
- **Election name**
- **Maximum selections per student (M):** students can pick from 1 up to M candidates. M must be **less than** the number of candidates.
- **Live candidate totals:** choose **Hide totals until voting closes** if you want to reduce the chance of working out how someone
  voted by watching totals change. Turnout stays live either way.
- Tap **Save settings**. The **Configuration check** box shows whether you're ready.

### 3. Review registrations
**Students** tab: search by name or registration number, and filter by **Voted / Not voted / Ineligible**.
If an account shouldn't vote (for example a duplicate or someone who isn't a student), tap **Revoke eligibility**. This is only possible before voting starts.

## During voting

### 4. Start voting
**Overview → Start voting → confirm.** Registration closes, and candidates and settings lock.
Students who are already logged in see the ballot within a few seconds, or when they tap Refresh.

### 5. Monitor turnout
**Overview** refreshes about every 4 seconds: registered, eligible, voted, not voted, turnout % and candidate totals.
"Live · updated HH:MM:SS" shows when the numbers were last refreshed. A red **Count mismatch** box means something is
inconsistent: stop and investigate. It should never appear.

### 6. Reset a forgotten password
1. **Check the student's identity in person** (college ID).
2. **Students** → search for the student → **Reset password** → **Create recovery link**.
3. A link is shown **once**. It works one time only and expires in 15 minutes. Tap **Copy link** and send it to that student
   privately, or let them type it on their phone.
4. The student opens the link, sets a new password, and logs in with their registration number and the new password.

Resetting a password signs the student out everywhere. It never changes whether they have voted. If they had already voted,
they still can't vote again.

## After voting

### 7. Close voting
**Overview → Stop voting → confirm.** No more ballots are accepted. A ballot already being submitted at that moment is either
fully counted or rejected, never half-counted.

### 8. Finalize the election
**Overview → Finalize election → confirm.** This permanently locks everything. Results stay visible and exportable.

### 9. Export results
**Overview → Export (CSV):**
- **Results:** votes per candidate (sorted), turnout, and a consistency check
- **Participation:** name, registration number, eligible, voted (never how anyone voted)
- **Audit log:** every administrative action

Keep these files safe. Ask your technical contact to run `npm run db:cleanup` and later delete the database, as described in the README.
