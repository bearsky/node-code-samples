const { DictionaryController } = require('../base');
const { dbServiceFactory, serviceFactory } = require('../../services');
const { AttendanceUnprocessedService } = require('../../services/attendance/attendance-unprocessed.service');
const { ManagerAttendanceProcessingService } = require('../../services/attendance/manager-attendance-processing.service');
const AttendanceReportsService = require('../../services/attendance/attendance-reports.service');

class AttendancesController extends DictionaryController {
  async delete(req, res) {
    res.status(403);
  }

  async deleteBulk(req, res) {
    res.status(403);
  }

  async create(req, res) {
    /** @type {AttendancesService} */
    const moduleService = this.getService(req);
    const attendance = await moduleService.getOrCreateForEmployeeAndDate(req.body.EmployeeID, req.body.Date);
    await moduleService.updateByPk(req.body, attendance.AttendanceID);

    const entity = await moduleService.refreshCounters(attendance.AttendanceID);

    res.send(entity);
  }

  async update(req, res) {
    const moduleService = this.getService(req);
    const id = +req.params.id;

    await moduleService.updateByPk(req.body, id);
    /** @type {AttendancesService} */
    const attendancesService = DictionaryController.rawGetService(req, 'attendances');

    const entity = await attendancesService.refreshCounters(id);

    res.send(entity);
  }

  async getMetrics(req, res) {
    /** @type AttendanceUnprocessedService */
    const service = dbServiceFactory(AttendanceUnprocessedService, req);

    res.json({
      unprocessedCount: await service.getUnprocessedCount(),
    });
  }

  async getReports(req, res) {
    /** @type {AttendancesReportsService} */
    const attendanceReportsService = serviceFactory(req, 'attendances', null, AttendanceReportsService);
    const reports = await attendanceReportsService.getReports(
      req.query.from,
      req.query.to,
      null,
      req.query.offset,
      req.query.limit,
      req.query.sort,
    );

    res.json(reports);
  }

  async getUnprocessedEmployees(req, res) {
    const service = dbServiceFactory(AttendanceUnprocessedService, req);
    const unprocessed = await service.getUnprocessedEmployees(req.query.limit, req.query.offset);

    res.json(unprocessed);
  }

  async getProcessingEmployees(req, res) {
    const service = dbServiceFactory(ManagerAttendanceProcessingService, req);
    const processing = await service.getProcessingEmployees(req.query);

    res.json(processing);
  }

  async getProcessingFilters(req, res) {
    const service = dbServiceFactory(ManagerAttendanceProcessingService, req);
    const filters = await service.getProcessingFilters(req.query.date);

    res.json(filters);
  }
}

module.exports = new AttendancesController('attendances');

