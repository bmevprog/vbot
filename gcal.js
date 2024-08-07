import { promises as fs } from 'fs';
import { join } from 'path';
import { cwd } from 'process';
import { authenticate } from '@google-cloud/local-auth';
import { google } from 'googleapis';
import fetch from 'node-fetch'; // Ensure you have node-fetch installed

// Google Calendar API setup
// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = join(cwd(), 'gcal_token.json');
const CREDENTIALS_PATH = join(cwd(), 'gcal_credentials.json');

/**
 * Reads previously authorized credentials from the save file.
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAuth.fromJSON.
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}

/**
 * Get upcoming contests from Codeforces API.
 */
async function fetchUpcomingContests() {
  const response = await fetch('https://codeforces.com/api/contest.list');
  const data = await response.json();
  
  if (data.status !== 'OK') {
    throw new Error('Failed to fetch contests from Codeforces');
  }

  // Filter contests with 'BEFORE' status
  return data.result.filter(contest => contest.phase === 'BEFORE');
}

/**
 * Convert seconds since epoch to RFC3339 format
 */
function toRFC3339(secondsSinceEpoch) {
  return new Date(secondsSinceEpoch * 1000).toISOString();
}

/**
 * Add or update contests in Google Calendar.
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function updateCalendar(auth) {
  const calendar = google.calendar({ version: 'v3', auth });
  const contests = await fetchUpcomingContests();

  for (const contest of contests) {
    const start = toRFC3339(contest.startTimeSeconds);
    const end = toRFC3339(contest.startTimeSeconds + contest.durationSeconds);

    const event = {
      summary: contest.name,
      description: `Type: ${contest.type}`,
      start: {
        dateTime: start,
        timeZone: 'UTC',
      },
      end: {
        dateTime: end,
        timeZone: 'UTC',
      },
      attendees: [{ email: 'versenyprogramozas@gmail.com' }],
      id: `codeforces-${contest.id}`,
    };

    try {
      // Try to get the event by ID
      await calendar.events.get({
        calendarId: 'primary',
        eventId: event.id,
      });

      // If found, update it
      await calendar.events.update({
        calendarId: 'primary',
        eventId: event.id,
        requestBody: event,
      });
      console.log(`Updated event: ${contest.name}`);
    } catch (err) {
      // If not found, create a new event
      if (err.code === 404) {
        await calendar.events.insert({
          calendarId: 'primary',
          requestBody: event,
        });
        console.log(`Added new event: ${contest.name}`);
      } else {
        console.error(`Error accessing event: ${err.message}`);
      }
    }
  }
}

authorize().then(updateCalendar).catch(console.error);
