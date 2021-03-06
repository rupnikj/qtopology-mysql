# Local testing

This directory contains files for testing `mysql` coordinator with a local instance of `MySQL` server.

Javascript:

- `cli.js` - used by bash scripts to connect to `mysql` via command line
- `gui.js` - starts web server for QTopology dashboard that connects to `mysql` instance
- `test_coordinator.js` - script for testing a complex coordination scenario
- `worker.js` - run several instances of this script to create several workers. Use unique names:
     - `node worker.js -n <worker_name>`

Bash scripts:

- `do_disable.sh` - disables all topologies in the `mysql` database
- `do_enable.sh` - enables all topologies in the `mysql` database
- `do_register.sh` - registers topologies into `mysql` database

# How to run these scripts

0. Set up proper `mysql` connection parameters in `config.json`
1. Run `do_register.sh` to get topology definitions into database
2. Run `do_disable.sh` to disable topologies for now. When workers start, they wont get picked up immediatelly.
3. Run `gui.js` to start dashboard. You can inspect topologies there.
4. Run several instances of worker in separate processes. Inspect dashboard to verify they properly registered:
    - `node worker.js -n worker1`
    - `node worker.js -n worker2`
    - `node worker.js -n worker3`
5. Run `do_enable.sh` - this will start distributing topologies among workers.
6. Kill one of the workers. You should see it's topologies assigned to other workers within several seconds.
7. Stop one of the topologies. This should remove it from the worker where it was running. The topology should also be marked as disabled, so other workers will not pick it up until it is enabled again.
