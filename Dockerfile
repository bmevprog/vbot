FROM node
ENV TZ="Europe/Budapest"
WORKDIR /usr/src/app
COPY . .
RUN npm install
CMD ["node", "contest_reminders.js"]
