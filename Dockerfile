FROM node:5.11.0-wheezy

ADD . /home

RUN cd /home; npm install --production

CMD /bin/bash -c 'cd /home; node src/service.js -t $SECURE_TOKEN'