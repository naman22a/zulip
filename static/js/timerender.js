import {
    differenceInCalendarDays,
    differenceInMinutes,
    format,
    formatISO,
    isEqual,
    isValid,
    parseISO,
    startOfToday,
} from "date-fns";
import $ from "jquery";
import _ from "lodash";

import render_markdown_time_tooltip from "../templates/markdown_time_tooltip.hbs";

import {$t} from "./i18n";
import {page_params} from "./page_params";

let next_timerender_id = 0;

export function clear_for_testing() {
    next_timerender_id = 0;
}

// Exported for tests only.
export function get_tz_with_UTC_offset(time) {
    const tz_offset = format(time, "xxx");
    let timezone = new Intl.DateTimeFormat(undefined, {timeZoneName: "short"})
        .formatToParts(time)
        .find(({type}) => type === "timeZoneName").value;

    if (timezone === "UTC") {
        return "UTC";
    }

    // When user's locale doesn't match their timezone (eg. en_US for IST),
    // we get `timezone` in the format of'GMT+x:y. We don't want to
    // show that along with (UTC+x:y)
    timezone = /GMT[+-][\d:]*/.test(timezone) ? "" : timezone;

    const tz_UTC_offset = `(UTC${tz_offset})`;

    if (timezone) {
        return timezone + " " + tz_UTC_offset;
    }
    return tz_UTC_offset;
}

// Given a Date object 'time', returns an object:
// {
//      time_str:        a string for the current human-formatted version
//      formal_time_str: a string for the current formally formatted version
//                          e.g. "Monday, April 15, 2017"
//      needs_update:    a boolean for if it will need to be updated when the
//                       day changes
// }
export function render_now(time, today = new Date()) {
    let time_str = "";
    let needs_update = false;
    // render formal time to be used for tippy tooltip
    // "\xa0" is U+00A0 NO-BREAK SPACE.
    // Can't use &nbsp; as that represents the literal string "&nbsp;".
    const formal_time_str = format(time, "EEEE,\u00A0MMMM\u00A0d,\u00A0yyyy");

    // How many days old is 'time'? 0 = today, 1 = yesterday, 7 = a
    // week ago, -1 = tomorrow, etc.

    // Presumably the result of diffDays will be an integer in this
    // case, but round it to be sure before comparing to integer
    // constants.
    const days_old = differenceInCalendarDays(today, time);

    if (days_old === 0) {
        time_str = $t({defaultMessage: "Today"});
        needs_update = true;
    } else if (days_old === 1) {
        time_str = $t({defaultMessage: "Yesterday"});
        needs_update = true;
    } else if (time.getFullYear() !== today.getFullYear()) {
        // For long running servers, searching backlog can get ambiguous
        // without a year stamp. Only show year if message is from an older year
        time_str = format(time, "MMM\u00A0dd,\u00A0yyyy");
        needs_update = false;
    } else {
        // For now, if we get a message from tomorrow, we don't bother
        // rewriting the timestamp when it gets to be tomorrow.
        time_str = format(time, "MMM\u00A0dd");
        needs_update = false;
    }
    return {
        time_str,
        formal_time_str,
        needs_update,
    };
}

// Current date is passed as an argument for unit testing
export function last_seen_status_from_date(last_active_date, current_date = new Date()) {
    const minutes = differenceInMinutes(current_date, last_active_date);
    if (minutes <= 2) {
        return $t({defaultMessage: "Just now"});
    }
    if (minutes < 60) {
        return $t({defaultMessage: "{minutes} minutes ago"}, {minutes});
    }

    const days_old = differenceInCalendarDays(current_date, last_active_date);
    const hours = Math.floor(minutes / 60);

    if (hours < 24) {
        if (hours === 1) {
            return $t({defaultMessage: "An hour ago"});
        }
        return $t({defaultMessage: "{hours} hours ago"}, {hours});
    }

    if (days_old === 1) {
        return $t({defaultMessage: "Yesterday"});
    }

    if (days_old < 90) {
        return $t({defaultMessage: "{days_old} days ago"}, {days_old});
    } else if (
        days_old > 90 &&
        days_old < 365 &&
        last_active_date.getFullYear() === current_date.getFullYear()
    ) {
        // Online more than 90 days ago, in the same year
        return $t(
            {defaultMessage: "{last_active_date}"},
            {last_active_date: format(last_active_date, "MMM\u00A0dd")},
        );
    }
    return $t(
        {defaultMessage: "{last_active_date}"},
        {last_active_date: format(last_active_date, "MMM\u00A0dd,\u00A0yyyy")},
    );
}

// List of the dates that need to be updated when the day changes.
// Each timestamp is represented as a list of length 2:
//   [id of the span element, Date representing the time]
let update_list = [];

// The time at the beginning of the day, when the timestamps were updated.
// Represented as a Date with hour, minute, second, millisecond 0.
let last_update;

export function initialize() {
    last_update = startOfToday();
}

// time_above is an optional argument, to support dates that look like:
// --- ▲ Yesterday ▲ ------ ▼ Today ▼ ---
function maybe_add_update_list_entry(entry) {
    if (entry.needs_update) {
        update_list.push(entry);
    }
}

function render_date_span(elem, rendered_time, rendered_time_above) {
    elem.text("");
    if (rendered_time_above !== undefined) {
        const pieces = [
            '<i class="date-direction fa fa-caret-up"></i>',
            _.escape(rendered_time_above.time_str),
            '<hr class="date-line">',
            '<i class="date-direction fa fa-caret-down"></i>',
            _.escape(rendered_time.time_str),
        ];
        elem.append(pieces);
        return elem;
    }
    elem.append(_.escape(rendered_time.time_str));
    return elem.attr("data-tippy-content", rendered_time.formal_time_str);
}

// Given an Date object 'time', return a DOM node that initially
// displays the human-formatted date, and is updated automatically as
// necessary (e.g. changing "Today" to "Yesterday" to "Jul 1").
// If two dates are given, it renders them as:
// --- ▲ Yesterday ▲ ------ ▼ Today ▼ ---

// (What's actually spliced into the message template is the contents
// of this DOM node as HTML, so effectively a copy of the node. That's
// okay since to update the time later we look up the node by its id.)
export function render_date(time, time_above, today) {
    const className = "timerender" + next_timerender_id;
    next_timerender_id += 1;
    const rendered_time = render_now(time, today);
    let node = $("<span />").attr("class", className);
    if (time_above !== undefined) {
        const rendered_time_above = render_now(time_above, today);
        node = render_date_span(node, rendered_time, rendered_time_above);
    } else {
        node = render_date_span(node, rendered_time);
    }
    maybe_add_update_list_entry({
        needs_update: rendered_time.needs_update,
        className,
        time,
        time_above,
    });
    return node;
}

// Renders the timestamp returned by the <time:> Markdown syntax.
export function render_markdown_timestamp(time) {
    const hourformat = page_params.twenty_four_hour_time ? "HH:mm" : "h:mm a";
    const timestring = format(time, "E, MMM d yyyy, " + hourformat);

    const tz_offset_str = get_tz_with_UTC_offset(time);
    const tooltip_html_content = render_markdown_time_tooltip({tz_offset_str});

    return {
        text: timestring,
        tooltip_content: tooltip_html_content,
    };
}

// This isn't expected to be called externally except manually for
// testing purposes.
export function update_timestamps() {
    const today = startOfToday();
    if (!isEqual(today, last_update)) {
        const to_process = update_list;
        update_list = [];

        for (const entry of to_process) {
            const className = entry.className;
            const elements = $(`.${CSS.escape(className)}`);
            // The element might not exist any more (because it
            // was in the zfilt table, or because we added
            // messages above it and re-collapsed).
            if (elements.length > 0) {
                const time = entry.time;
                const time_above = entry.time_above;
                const rendered_time = render_now(time, today);
                const rendered_time_above = time_above ? render_now(time_above, today) : undefined;
                for (const element of elements) {
                    render_date_span($(element), rendered_time, rendered_time_above);
                }
                maybe_add_update_list_entry({
                    needs_update: rendered_time.needs_update,
                    className,
                    time,
                    time_above,
                });
            }
        }

        last_update = today;
    }
}

setInterval(update_timestamps, 60 * 1000);

// Transform a Unix timestamp into a ISO 8601 formatted date string.
//   Example: 1978-10-31T13:37:42Z
export function get_full_time(timestamp) {
    return formatISO(timestamp * 1000);
}

export function get_timestamp_for_flatpickr(timestring) {
    let timestamp;
    try {
        // If there's already a valid time in the compose box,
        // we use it to initialize the flatpickr instance.
        timestamp = parseISO(timestring);
    } finally {
        // Otherwise, default to showing the current time.
        if (!timestamp || !isValid(timestamp)) {
            timestamp = new Date();
        }
    }
    return timestamp;
}

export function stringify_time(time) {
    if (page_params.twenty_four_hour_time) {
        return format(time, "HH:mm");
    }
    return format(time, "h:mm a");
}

// this is for rendering absolute time based off the preferences for twenty-four
// hour time in the format of "%mmm %d, %h:%m %p".
export const absolute_time = (function () {
    const MONTHS = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
    ];

    const fmt_time = function (date, H_24) {
        const payload = {
            hours: date.getHours(),
            minutes: date.getMinutes(),
        };

        if (payload.hours > 12 && !H_24) {
            payload.hours -= 12;
            payload.is_pm = true;
        }

        let str = ("0" + payload.hours).slice(-2) + ":" + ("0" + payload.minutes).slice(-2);

        if (!H_24) {
            str += payload.is_pm ? " PM" : " AM";
        }

        return str;
    };

    return function (timestamp, today = new Date()) {
        const date = new Date(timestamp);
        const is_older_year = today.getFullYear() - date.getFullYear() > 0;
        const H_24 = page_params.twenty_four_hour_time;
        let str = MONTHS[date.getMonth()] + " " + date.getDate();
        // include year if message date is from a previous year
        if (is_older_year) {
            str += ", " + date.getFullYear();
        }
        str += " " + fmt_time(date, H_24);
        return str;
    };
})();

export function get_full_datetime(time) {
    const time_options = {timeStyle: "medium"};

    if (page_params.twenty_four_hour_time) {
        time_options.hourCycle = "h24";
    }

    const date_string = time.toLocaleDateString();
    let time_string = time.toLocaleTimeString(undefined, time_options);

    const tz_offset_str = get_tz_with_UTC_offset(time);

    time_string = time_string + " " + tz_offset_str;

    return $t({defaultMessage: "{date} at {time}"}, {date: date_string, time: time_string});
}
