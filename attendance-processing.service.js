const { Op } = require('sequelize');
const moment = require('moment');

const { DbRelatedService } = require('../db-related-service');
const WorkdaysService = require('../workdays.service');

/**
 * @typedef WorkingPeriod
 * @property from {moment.Moment|string|Date}
 * @property to {moment.Moment|string|Date}
 * @property daysOfWeek {string[]}
 */

/**
 * @typedef ExpectedWorkdays
 * @property daysOfWeek {string[]}
 * @property count {number}
 */

class AttendanceProcessingService extends DbRelatedService {
  constructor(db) {
    super(db);

    this.employeeWorkdaysPeriodsCache = {};
    this.workdaysService = new WorkdaysService(db.workdays, db);
  }

  /**
   * @param employee {EmployeesModel}
   * @param from {string|moment.Moment|Date}
   * @param to {string|moment.Moment|Date}
   * @return {Promise<boolean>}
   */
  async isUserProcessed(employee, from, to) {
    let workdaysPeriods = await this.getEmployeeWorkdaysPeriods(employee);

    workdaysPeriods = this.filterPeriodsInRange(workdaysPeriods, from, to);

    while (workdaysPeriods.length) {
      const period = workdaysPeriods.pop();

      if (!(await this.isEmployeeProcessedInPeriod(employee, period))) { // eslint-disable-line no-await-in-loop
        return false;
      }
    }

    return true;
  }

  /**
   * Returns true if given employee has any working days in given date range.
   * This check could be eventually implemented on the database side (function) to speed up selecting working employees.
   *
   * @param employee {EmployeesModel}
   * @param from {string|moment.Moment|Date}
   * @param to {string|moment.Moment|Date}
   * @return {Promise<boolean>}
   */
  async shouldEmployeeWorkBetween(employee, from, to) {
    let workdaysPeriods = await this.getEmployeeWorkdaysPeriods(employee);

    workdaysPeriods = this.filterPeriodsInRange(workdaysPeriods, from, to);

    while (workdaysPeriods.length) {
      const period = workdaysPeriods.pop();
      const expectedWorkdays = this.getEmployeeExpectedWorkdaysForPeriod(employee, period);

      if (expectedWorkdays.count) {
        return true;
      }
    }

    return false;
  }

  /**
   * @param employee {EmployeesModel}
   * @param from {string|moment.Moment|Date}
   * @param to {string|moment.Moment|Date}
   * @return {Promise<{}>}
   */
  async generateEmployeeWorkStates(employee, from, to) {
    let result = {};
    let workdaysPeriods = await this.getEmployeeWorkdaysPeriods(employee);

    workdaysPeriods = this.filterPeriodsInRange(workdaysPeriods, from, to);

    while (workdaysPeriods.length) {
      const period = workdaysPeriods.pop();
      const expectedWorkdays = this.getEmployeeExpectedWorkdaysForPeriod(employee, period);

      result = {
        ...result,
        ...this.getEmployeeWorkStates(employee, period.from, period.to, expectedWorkdays),
      };
    }

    return result;
  }

  /**
   * @param employee {EmployeesModel}
   * @param from {string|moment.Moment|Date}
   * @param to {string|moment.Moment|Date}
   * @param expectedWorkdays {ExpectedWorkdays}
   * @return {{}}
   */
  getEmployeeWorkStates(employee, from, to, expectedWorkdays) {
    const dateFrom = new Date(moment.utc(from).startOf('day').toISOString());
    const dateTo = new Date(moment.utc(to).startOf('day').toISOString());
    const result = {};

    while (dateFrom <= dateTo) {
      result[dateFrom.getTime()] = expectedWorkdays.daysOfWeek.includes(String(dateFrom.getDay() + 1));
      dateFrom.setDate(dateFrom.getDate() + 1);
    }

    return result;
  }

  /**
   * @param employee {EmployeesModel}
   * @param period {WorkingPeriod}
   * @return {ExpectedWorkdays}
   */
  getEmployeeExpectedWorkdaysForPeriod(employee, period) {
    const workdaysNumbers = Object.entries(period.daysOfWeek).filter(([, shouldWork]) => shouldWork).map(item => item[0]);

    const expectedWorkdays = this.filterAndCountDaysOfWeekBetween(workdaysNumbers, period.from, period.to);

    return {
      ...expectedWorkdays,
      daysOfWeek: expectedWorkdays.daysOfWeek.filter(dow => ![6, 7].includes(dow)),
    };
  }

  /**
   * @param employee {EmployeesModel}
   * @param period {WorkingPeriod}
   * @return {boolean}
   */
  async isEmployeeProcessedInPeriod(employee, period) {
    const expectedWorkdays = this.getEmployeeExpectedWorkdaysForPeriod(employee, period);

    if (!expectedWorkdays.count) {
      return true;
    }

    const logsCount = await this.db.attendances.count({
      where: [
        { EmployeeID: employee.EmployeeID },
        {
          [Op.or]: {
            CheckedIn: true,
            RegularHours: { [Op.gt]: 0 },
            OvertimeHours: { [Op.gt]: 0 },
            SickHours: { [Op.gt]: 0 },
            HolidayHours: { [Op.gt]: 0 },
            UnpaidHours: { [Op.gt]: 0 },
            RegularHoursOverride: { [Op.gt]: 0 },
            OvertimeHoursOverride: { [Op.gt]: 0 },
            SickHoursOverride: { [Op.gt]: 0 },
            HolidayHoursOverride: { [Op.gt]: 0 },
            UnpaidHoursOverride: { [Op.gt]: 0 },
            OtherHours: { [Op.gt]: 0 },
          },
        },
        { [Op.and]: this.sequelize.literal(`DAYOFWEEK(Date) IN (${expectedWorkdays.daysOfWeek.join(',')})`) },
        { Date: { [Op.gte]: period.from } },
        { Date: { [Op.lte]: period.to } },
      ],
      raw: true,
    });

    return expectedWorkdays.count <= logsCount;
  }

  /**
   * @param employee {EmployeesModel}
   * @return {Promise<WorkingPeriod[]>}
   */
  async getEmployeeWorkdaysPeriods(employee) {
    const cache = this.employeeWorkdaysPeriodsCache[employee.EmployeeID];

    if (cache) {
      return cache;
    }

    this.sequelize.query('SET SESSION sql_mode=""');

    /** @type {Array<WorkDaysModel>} */
    const workdays = await this.db.workdays.findAll({
      where: {
        EmployeeID: employee.EmployeeID,
        createdAt: {
          [Op.in]: this.sequelize.literal(
            `(SELECT MAX(createdAt) FROM workdays WHERE EmployeeID = ${employee.EmployeeID} GROUP BY DATE(createdAt))`,
          ),
        },
      },
      order: [['createdAt', 'DESC']],
      raw: true,
    });

    const result = [];

    workdays.reduce(
      (previousDate, workday) => {
        result.push({
          to: previousDate,
          from: workday.createdAt,
          daysOfWeek: this.workdaysService.makeWorkdaysMap(workday),
        });

        return moment.utc(workday.createdAt).subtract(1, 'days').toISOString();
      },
      (new Date()).toISOString(),
    );

    if (result.length) {
      result[result.length - 1].from = employee.StartDate;
    }

    if (employee.LeavingDate) {
      const filteredPeriods = this.filterPeriodsInRange(result, employee.StartDate, employee.LeavingDate);

      this.employeeWorkdaysPeriodsCache[employee.EmployeeID] = filteredPeriods;

      return filteredPeriods;
    }

    this.employeeWorkdaysPeriodsCache[employee.EmployeeID] = result;

    return result;
  }

  /**
   * @param periods {WorkingPeriod[]}
   * @param from {string|moment.Moment|Date}
   * @param to {string|moment.Moment|Date}
   * @return {WorkingPeriod[]}
   */
  filterPeriodsInRange(periods, from, to) {
    const fromDate = from ? moment.utc(from) : false;
    const toDate = to ? moment.utc(to) : false;

    return periods.map((period) => {
      let validFrom = true;
      let validTo = true;
      const newPeriod = { ...period };

      if (fromDate) {
        validFrom = fromDate.isSameOrBefore(period.to, 'day');

        if (fromDate.isAfter(period.from, 'day')) {
          newPeriod.from = fromDate.toISOString();
        }
      }

      if (toDate) {
        validTo = toDate.isSameOrAfter(period.from, 'day');

        if (toDate.isBefore(period.to, 'day')) {
          newPeriod.to = toDate.toISOString();
        }
      }

      if (validFrom && validTo) {
        return newPeriod;
      }

      return null;
    }).filter(period => period);
  }

  /**
   * @param daysOfWeek {string[]}
   * @param from {Date|moment.Moment|string}
   * @param to {Date|moment.Moment|string}
   * @return {ExpectedWorkdays}
   * @private
   */
  filterAndCountDaysOfWeekBetween(daysOfWeek, from, to) {
    const result = {
      daysOfWeek: [],
      count: 0,
    };

    if (!daysOfWeek.length) {
      return result;
    }

    const daysBetween = moment.utc(to).diff(moment.utc(from), 'days') + 1;

    if (Number.isNaN(daysBetween)) {
      return result;
    }

    if (daysBetween / 7 >= 1) {
      // include all allowed days of week because given period covers at least a 1 whole week
      result.daysOfWeek = daysOfWeek;
    }

    let weekRestDays = daysBetween % 7;
    const restDay = moment.utc(to).subtract(weekRestDays, 'days');

    // iterate through days of last non-full week and check which days to count in
    while (weekRestDays--) {
      restDay.add(1, 'days');

      const dayOfWeekNo = (restDay.day() + 1).toString();

      if (daysOfWeek.includes(dayOfWeekNo)) {
        result.count++;

        if (!result.daysOfWeek.includes(dayOfWeekNo)) {
          result.daysOfWeek.push(dayOfWeekNo);
        }
      }
    }

    // add number of days included in full weeks
    result.count += Math.floor(daysBetween / 7) * daysOfWeek.length;

    return result;
  }

  getWorkingEmployees(attributes) {
    return this.db.employees.findAll({
      attributes,
      where: {
        [Op.and]: [
          { StartDate: { [Op.not]: null } },
          { StartDate: { [Op.lte]: new Date() } },
          { EmployeeStatusID: { [Op.in]: [1, 4] } },
        ]
      },
      include: [
        {
          attributes: [],
          model: this.db.workdays,
          as: 'WorkDayObject',
          required: true
        },
      ],
      raw: true,
    });
  }
}

module.exports = { AttendanceProcessingService };

