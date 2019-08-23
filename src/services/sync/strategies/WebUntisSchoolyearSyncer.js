const WebUntisSyncer = require('./WebUntisSyncer');

const assert = require('assert');

const Lesson = require('../../lesson/model');
const { userModel: User } = require('../../user/model');
const { schoolModel: School, yearModel: Year } = require('../../school/model');

const {
	extractOne,
} = require('../../teams/helpers');

/**
 * Implements syncing from WebUntis API based on the Syncer interface
 * @class WebUntisSchoolyearSyncer
 * @implements {Syncer}
 */
class WebUntisSchoolyearSyncer extends WebUntisSyncer {

	constructor(app, stats, account) {
        super(app, stats, account);
	}

	/**
	 * @see {Syncer#respondsTo}
	 */
	static respondsTo(target) {
		return target === 'webuntis-schoolyear';
	}

	static params(params, data) {
		return [params.account];
	}

	/**
	 * @see {Syncer#steps}
     * 
     * Steps:
     * * Check for WebUntis system (may have configured none)
     * * Login to WebUntis
     * * Fetch Lesson/Teacher/Room/... changes
     * * Migrate the changes
     * * Generate events using text templates
     * * Send out events for all affected student/teacher/...
     * 
     * Assumptions:
     * * Each school has one WebUntis system at most
     * * This syncer has to be triggered for each school individually
	 */
	steps() {
        /* Why not
        return this.getWebUntisSystems().then(
            systems => {
                // ...
            }
        );
        ? */
        return this.getUser()
            .then(user => this.getWebUntisSystems(user))
			.then(([systems, school]) => {
                /* TODO: Remove later */
                // if (systems.length === 0) {
                    
                // }

                if (systems.length === 0) {
                    return Promise.reject(
                        new Error('No WebUntis configuration for associated school.')
                    );
                }
                this.logInfo(`Found ${systems.length} WebUntis configurations for school ${school.name}.`);
				return Promise.all(systems.map(system => {
					this.stats.systems[school.name] = {};
					return this.syncFromSystem(system, this.stats.systems[school.name], this.app, school);
				}));
			});
    }
    
    async syncFromSystem(system, stats, app, school) {
        return this.login(system.webuntisConfig.url, system.webuntisConfig.schoolname,
            system.webuntisConfig.user, system.webuntisConfig.password)
            .then(() => this.fetchInformation(stats, app))
            .then((data) => {
                this.logout();
                return Promise.resolve(data)
            })
            .then((data) => {
                return this.migrateData(data, stats, school);
            })
            .then(() => {
                stats.success = true;
            });
    }

    async fetchInformation(stats, app) {
        let intermediateData = {};
        let data = {};
        data.currentSchoolYear = await this.getCurrentSchoolyear();
        // intermediateData.holidays = await this.getHolidays();
        // data.subjects = await this.getSubjects(); // Ignore subjects for now
        intermediateData.timeGrid = await this.getTimegrid();
        intermediateData.classes = await this.getClasses(data.currentSchoolYear.id);
        intermediateData.rooms = await this.getRooms();

        // data.holidayRanges = data.holidays.map(holiday => [ holiday.startDate, holiday.endDate ]);
        data.classes = intermediateData.classes.map(klass => {
            return {
                "id": klass.id,
                "name": klass.longName,
                "timetable": []
            };
        });
        data.timeGrid = intermediateData.timeGrid.map(day => {
            return {
                "day": this.dayLookUp(day.day),
                "timeUnits": day.timeUnits
            }
        });

        data.rooms = intermediateData.rooms.map(room => { return {
            "id": room.id,
            "name": room.name + " (" + room.longName + (room.building !== "" ? ", " + room.building : "") + ")"
        }; });

        // TODO: remove
        data.rooms.length = 2;
        // END TODO: remove
        
        for (let index in data.rooms) {
            let timetable = await this.getCustomizableTimeTableFor(4, data.rooms[index].id, {
                "startDate": data.currentSchoolYear.startDate,
                "endDate": data.currentSchoolYear.endDate,
                "onlyBaseTimetable": true,
                "klasseFields": [ "id", "longname" ],
                "subjectFields": [ "id", "longname" ],
                "teacherFields": [ "id", "longname" ]
            });
            timetable = timetable.filter(entry => 
                entry.ro.length === 1 &&
                entry.ro[0].id === data.rooms[index].id &&
                entry.kl.length > 0 &&
                entry.te.length === 1 &&
                entry.su.length === 1
            );

            for (let entryIndex in timetable) {
                let entry = timetable[entryIndex];
                for (let klassIndex in entry.kl) {
                    let klass = data.classes.find(k => {
                        return k.id === entry.kl[klassIndex].id;
                    });

                    if (klass === undefined) {
                        continue;
                    }

                    klass.timetable.push({
                        "date": entry.date,
                        "startTime": entry.startTime,
                        "endTime": entry.endTime,
                        "teacher": entry.te[0].longname,
                        "subject": entry.su[0].longname,
                        "room": data.rooms[index].name
                    });
                }
            }
        }

        return Promise.resolve(data);
    }

    async migrateData(data, stats, school) {
		const courseService = this.app.service('courses');
        const classService = this.app.service('classes');

        stats.classes = {};
        stats.classes.count = 0;
        stats.classes.createdCount = 0;
        stats.classes.reusedCount = 0;
        stats.courses = {};
        stats.courses.count = 0;
        stats.courses.createdCount = 0;
        stats.courses.reusedCount = 0;
        stats.times = {};
        stats.times.count = 0;

        /**
         * Mapping:
         * 
         * Schul-Cloud: class, course (per class), lesson
         * WebUntis: class, subject
         * German: Klasse, Kurs, Fach, Schulstunde
         */

        for (let classIndex in data.classes) {
            /**
             * Obtain classes
             */
            const klass = data.classes[classIndex];
            const className = klass.name;
            this.logInfo(`Handle ${className}\n`);
            const scClasses = await classService.find({ query: { name: className }, paginate: false });

            let scClass = scClasses[0];
            if (scClass === undefined) {
                // Create Schul-Cloud class?
                const newClass = {
					name: className,
					schoolId: school._id,
					nameFormat: 'static',
					year: school.currentYear,
				};
                scClass = await classService.create(newClass);
                stats.classes.createdCount += 1;
            } else {
                stats.classes.reusedCount += 1;
            }

            const courses = {};
            const times = {};
            for (let timetableIndex in klass.timetable) {
                const timetableEntry = klass.timetable[timetableIndex];

                /** Obtain courses for subjects:
                 * 
                 * - class
                 * - (teacher)
                 * - time series
                 * - room
                 */
                const subjectName = timetableEntry.subject;

                let scCourse = courses[subjectName];
                if (scCourse === undefined) {
                    const courseName = subjectName + " " + scClass.name;
                    this.logInfo(`Handle ${courseName}\n`);
                    const scCourses = await courseService.find({ query: {
                        name: courseName,
                        classIds: scClass._id,
                        schoolId: school._id
                    }, paginate: false });
                    scCourse = scCourses[0];
                    if (scCourse === undefined) {
                        // Create Course
                        const newCourse = {
                            name: courseName,
                            classIds: [ scClass._id ],
                            schoolId: school._id,
                            teacherIds: [ /* TODO: user id */ ],
                        };

                        scCourse = await courseService.create(newCourse);
                        courses[subjectName] = scCourse;
                        times[subjectName] = [];
                        stats.courses.createdCount += 1;
                    } else {
                        courses[subjectName] = scCourse;
                        stats.courses.reusedCount += 1;
                        times[subjectName] = [];
                    }
                }
                
                const newEntry = {
                    weekday: this.getWeekDay(timetableEntry.date),
                    startTime: this.getStartTime(timetableEntry.startTime),
                    duration: this.getDuration(timetableEntry.startTime, timetableEntry.endTime),
                    room: timetableEntry.room,
                    count: 1
                };
                let entryFound = false;
                for (let index in times[subjectName]) {
                    const givenEntry = times[subjectName][index];
                    if (givenEntry.weekday === newEntry.weekday &&
                        givenEntry.startTime === newEntry.startTime &&
                        givenEntry.duration === newEntry.duration &&
                        givenEntry.room === newEntry.room) {
                        givenEntry.count += 1;
                        entryFound = true;
                    }
                }
                if (!entryFound) {
                    times[subjectName].push(newEntry);
                    stats.times.count += 1;
                }
            }

            for (let subjectName in courses) {
                const scCourse = courses[subjectName];
                const courseTimes = times[subjectName];
                // Update times, considered are events that occurs at least twice a year
                scCourse.times = courseTimes.filter(entry => entry.count >= 2).map(entry => {
                    return {
                        weekday: entry.weekday,
                        startTime: entry.startTime,
                        duration: entry.duration,
                        eventId: undefined,
                        room: entry.room,
                    }
                });
            }
        }

        return Promise.resolve();
    }
}

module.exports = WebUntisSchoolyearSyncer;
