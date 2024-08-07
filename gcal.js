import { google } from 'googleapis';
import fetch from 'node-fetch';
import { authorize } from './gcal_client.js';

async function fetchUpcomingContests() {
  const response = await fetch('https://codeforces.com/api/contest.list');
  const data = await response.json();
  if (data.status !== 'OK') {
    throw new Error('Failed to fetch contests from Codeforces');
  }
  return data.result.filter(contest => contest.phase === 'BEFORE');
}

function toRFC3339(secondsSinceEpoch) {
  return new Date(secondsSinceEpoch * 1000).toISOString();
}

function eventDiff(existingEvent, newEvent) {
  var result = {}
  if (existingEvent.summary !== newEvent.summary) {
    result.summary = newEvent.summary;
  }
  if (existingEvent.description !== newEvent.description) {
    result.description = newEvent.description;
  }
  if (new Date(existingEvent.start.dateTime).getTime() !== new Date(newEvent.start.dateTime).getTime()) {
    result.start = newEvent.start;
  }
  if (new Date(existingEvent.end.dateTime).getTime() !== new Date(newEvent.end.dateTime).getTime()) {
    result.end = newEvent.end;
  }
  if (existingEvent.location !== newEvent.location) {
    result.location = newEvent.location;
  }
  if (Object.keys(result).length === 0) {
    return null;
  }
  return result;
}

async function updateGoogleCalendar(auth) {
  const calendar = google.calendar({ version: 'v3', auth });
  const contests = await fetchUpcomingContests();

  const { data: { items: existingEvents } } = await calendar.events.list({
    calendarId: 'primary',
    q: 'codeforces.com',
  });

  for (const contest of contests) {
    const start = toRFC3339(contest.startTimeSeconds);
    const end = toRFC3339(contest.startTimeSeconds + contest.durationSeconds);
    const location = `https://codeforces.com/contests/${contest.id}`;

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
      attendees: [{ email: 'viktoria.nemkin@gmail.com' }],
      location: location
    };

    const existingEvent = existingEvents.find(e => e.location === location);

    if (existingEvent) {
      var diff = eventDiff(existingEvent, event);
      if(diff) {
        await calendar.events.update({
          calendarId: 'primary',
          eventId: existingEvent.id,
          requestBody: event,
        });
        console.log(`Updated event: ${contest.name}`);
      } else {
        console.log(`Event already up to date: ${contest.name}`);
      }
    } else {
      await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
      });
      console.log(`Added new event: ${contest.name}`);
    }
  }
}

authorize().then(updateGoogleCalendar).catch(console.error);
