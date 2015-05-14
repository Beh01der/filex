FROM node:0.12.2

ADD . /home

RUN cd /home; npm install

CMD /bin/bash -c 'cd /home; node src/service.js $SECURE_TOKEN'