
// CLI usage:
// phantomjs [--ssl-protocol=any] ge-cancellation-checker.phantom.js [-v|--verbose]

var system = require('system');
var fs = require('fs');

var VERBOSE = false;
var loadInProgress = false;

var data = {};

// Calculate path of this file
var PWD = '';
var current_path_arr = system.args[0].split('/');
if (current_path_arr.length == 1) { PWD = '.'; }
else {
    current_path_arr.pop();
    PWD = current_path_arr.join('/');
}

// Gather Settings...
try {
    var settings = JSON.parse(fs.read(PWD + '/config.json'));
    if (!settings.username || !settings.username || !settings.init_url || !settings.enrollment_location_id) {
        console.log('Missing username, password, enrollment location ID, and/or initial URL. Exiting...');
        phantom.exit();
    }
}
catch(e) {
    console.log('Could not find config.json');
    phantom.exit();
}

// ...from command
system.args.forEach(function(val, i) {
    if (val == '-v' || val == '--verbose') { VERBOSE = true; }
});

function fireClick(el) {
    var ev = document.createEvent("MouseEvents");
    ev.initEvent("click", true, true);
    el.dispatchEvent(ev);
}

var page = require('webpage').create();
page.settings.userAgent = 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/37.0.2062.120 Safari/537.36';

page.onConsoleMessage = function(msg) {
    if (!VERBOSE) { return; }
    console.log(msg);
};

page.onError = function(msg, trace) {
    if (!VERBOSE) { return; }
    console.error('Error on page: ' + msg);
}

page.onCallback = function(query, msg) {
    if (query == 'username') { return settings.username; }
    if (query == 'password') { return settings.password; }
    if (query == 'currentDate') { return settings.current_interview_date_str; }
    if (query == 'earliestDate') { return data.earliestDate; }
    if (query == 'setEarliestDate') { data.earliestDate = msg; return data.earliestDate;}
    if (query == 'log') { console.log(msg); return; }
    if (query == 'fireClick') {
        return function() { return fireClick; } // @todo:david DON'T KNOW WHY THIS DOESN'T WORK! :( Just returns [Object object])
    }
    if (query == 'report-interview-time') {
        if (VERBOSE) { console.log('Next available appointment is at: ' + msg); }
        else { console.log(msg); }
        return;
    }
    if (query == 'report-no-interviews') {
        if (VERBOSE) { console.log('No new interviews available. Please try again later.'); }
        else { console.log('None'); }
        return;
    }
    if (query == 'fatal-error') {
        console.log('Fatal error: ' + msg);
        phantom.exit();
    }
    return null;
}

page.onLoadStarted = function() { loadInProgress = true; };
page.onLoadFinished = function() { loadInProgress = false; };

if (VERBOSE) { console.log('Please wait...'); }

page.open(settings.init_url);
var steps = [
    function() { // Log in
        page.evaluate(function() {
            console.log('On GOES login page...');
            document.querySelector('input[name=j_username]').value = window.callPhantom('username');

            /* The GE Login page limits passwords to only 12 characters, but phantomjs can get around
               this limitation, which causes the fatal error "Unable to find terms acceptance button" */
            document.querySelector('input[name=j_password]').value = window.callPhantom('password').substring(0,12);
            document.querySelector('form[action=j_security_check]').submit();
            console.log('Logging in...');
        });
    },
    function() { // Accept terms
        page.evaluate(function() {

	    submitHome();

            console.log('Bypassing human check...');
        });
    },
    function() { // main dashboard
        page.evaluate(function() {

            function fireClick(el) {
                var ev = document.createEvent("MouseEvents");
                ev.initEvent("click", true, true);
                el.dispatchEvent(ev);
            }

            var $manageAptBtn = document.querySelector('.bluebutton[name=manageAptm]');
            if (!$manageAptBtn) {
                return window.callPhantom('fatal-error', 'Unable to find Manage Appointment button');
            }

            fireClick($manageAptBtn);
            console.log('Entering appointment management...');
        });
    },
    function() {
        page.evaluate(function() {

            function fireClick(el) {
                var ev = document.createEvent("MouseEvents");
                ev.initEvent("click", true, true);
                el.dispatchEvent(ev);
            }

            var $rescheduleBtn = document.querySelector('input[name=reschedule]');

            if (!$rescheduleBtn) {
                return window.callPhantom('fatal-error', 'Unable to find reschedule button. Is it after or less than 24 hrs before your appointment?');
            }

            fireClick($rescheduleBtn);
            console.log('Entering rescheduling selection page...');
        });
    },
    function() {
        page.evaluate(function(location_id) {

            function fireClick(el) {
                var ev = document.createEvent("MouseEvents");
                ev.initEvent("click", true, true);
                el.dispatchEvent(ev);
            }

            document.querySelector('select[name=selectedEnrollmentCenter]').value = location_id;
            fireClick(document.querySelector('input[name=next]'));

            var location_name = document.querySelector('option[value="' + location_id + '"]').text;
            console.log('Choosing Location: ' + location_name);
        }, settings.enrollment_location_id.toString());
    },
    function() {

        page.evaluate(function() {
            function fireClick(el) {
                var ev = document.createEvent("MouseEvents");
                ev.initEvent("click", true, true);
                el.dispatchEvent(ev);
            }

            // If there are no more appointments available at all, there will be a message saying so.
            try {
                if (document.querySelector('span.SectionHeader').innerHTML == 'Appointments are Fully Booked') {
                    window.callPhantom('report-no-interviews');
                    return;
                }
            } catch(e) { }

            // We made it! Now we have to scrape the page for the earliest available date
            var date = document.querySelector('.date table tr:first-child td:first-child').innerHTML;
            var month_year = document.querySelector('.date table tr:last-child td:last-child div').innerHTML;

            var full_date = month_year.replace(',', ' ' + date + ',');
            window.callPhantom('setEarliestDate', full_date)
            var earliest = document.querySelector('.schedule-detailed table a.entry')
            fireClick(earliest)
        });
    },
    function() {

        page.evaluate(function() {
          console.log('evaluated last page')
            function fireClick(el) {
                var ev = document.createEvent("MouseEvents");
                ev.initEvent("click", true, true);
                el.dispatchEvent(ev);
            }

            // Set reason
            document.querySelector('input[name=comments]').value = 'earlier date';
            var confirm = document.querySelector('input[name=Confirm]');
            var current = document.querySelectorAll('.maincontainer p')[5].innerHTML
            current = /\<\/strong\>(.+)/.exec(current)[1]
            current = new Date(current)
            var earliest = new Date(window.callPhantom('earliestDate'));
            var msg;

            if (earliest < current) {
              msg = 'Earliest appointment, ' + earliest.toDateString() + ', is sooner than current appointment, ' + current.toDateString() + '.';
              msg = msg + ' Attempting to confirm this date.';
              fireClick(confirm)
            } else {
              msg = 'Earliest appointment, ' + earliest.toDateString() + ', occurs after the current appointment, ' + current.toDateString() + '.';
              msg = msg + ' Aborting...';
            }

            window.callPhantom('report-interview-time', earliest.toLocaleDateString())
        });
    }
];

var i = 0;
interval = setInterval(function() {
    if (loadInProgress) { return; } // not ready yet...
    if (typeof steps[i] != "function") {
        return phantom.exit();
    }

    steps[i]();
    i++;

}, 100);
