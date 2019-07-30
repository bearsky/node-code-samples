const { Controller } = require('./base');
const { serviceFactory } = require('../services/index');


class DraftEmployeeController extends Controller {
  async toEmployee(req, res) {
    const service = this.getService(req);
    const employeeService = serviceFactory(req, 'employees');
    const resolvedDraftEmployeeConflictService = serviceFactory(req, 'ResolvedDraftEmployeeConflict');
    await Promise.all([service.checkDuplicates(req, employeeService, resolvedDraftEmployeeConflictService), service.checkValidation(req)]);
    const results = await service.toEmployee(req, employeeService);
    const createdEmployees = results.filter(result => result !== null);
    res.json({ msg: `Success! ${createdEmployees.length} employees has been created.` });
  }

  async countErrors(req, res) {
    const service = this.getService(req);
    const employeeService = serviceFactory(req, 'employees');
    const resolvedDraftEmployeeConflictService = serviceFactory(req, 'ResolvedDraftEmployeeConflict');
    const duplicates = await service.checkDuplicates(req, employeeService, resolvedDraftEmployeeConflictService);
    const validationErrors = await service.checkValidation(req);
    res.json({ duplications: duplicates.length, validationErrors: validationErrors.length });
  }

  async checkDuplicates(req, res) {
    const service = this.getService(req);
    const employeeService = serviceFactory(req, 'employees');
    const resolvedDraftEmployeeConflictService = serviceFactory(req, 'ResolvedDraftEmployeeConflict');
    const result = await service.checkDuplicates(req, employeeService, resolvedDraftEmployeeConflictService);
    const count = result.length;
    res.json({
      count: result.length,
      result,
      msg: count ? 'Conflicts! Validated fields: Email, WorkPhone, SSN, Name and Surname' : 'OK'
    });
  }

  async checkValidation(req, res) {
    const service = this.getService(req);
    const result = await service.checkValidation(req);
    const count = result.length;
    res.json({
      count: result.length,
      result,
      msg: count ? 'Email or Mobile not valid' : 'OK'
    });
  }

  async undoLastImport(req, res) {
    const service = this.getService(req);
    const allDraftEmplyoees = await service.findAll({ sort: 'ImportedDate:DESC' });
    if (allDraftEmplyoees.length > 0) {
      const lastImportHash = allDraftEmplyoees[0].ImportHash;
      const deletedCount = await service.model.destroy({ where: { ImportHash: lastImportHash } });
      res.json({ msg: `${deletedCount} draft employees has been deleted` });
    } else {
      res.json({ msg: 'No import to undo!' });
    }
  }

  async markConflictAsResolved(req, res) {
    this.getService(req);
    const fieldsThatCannotBeIngored = ['SSN', 'Login', 'Email'];
    const objects = req.body;
    const errors = [];
    const resolvedDraftEmployeeConflictService = serviceFactory(req, 'ResolvedDraftEmployeeConflict');
    objects.forEach(async (object) => {
      if (fieldsThatCannotBeIngored.includes(object.field)) {
        errors.push({ msg: `${object.field} cannot be ingored!` });
      } else {
        await resolvedDraftEmployeeConflictService.create({
          DraftEmployeeID: object.DraftEmployeeID,
          Field: object.field
        });
      }
    });
    if (errors.length > 0) {
      res.json(errors);
    } else {
      res.json({ msg: 'OK' });
    }
  }

  async getFileNames(req, res) {
    const service = this.getService(req);
    const fileNames = service.model.aggregate('ImportFileName', 'DISTINCT', { plain: false });
    const result = (await fileNames).map(row => row.DISTINCT);
    res.json(result);
  }

  async deleteBulk(req, res) {
    const moduleService = this.getService(req);
    const destroyedObjects = await moduleService.destroyBulkByPk(req.body, req.query.simulate);
    res.send(destroyedObjects);
  }
}
const draftEmployeeController = new DraftEmployeeController('employeesdraft');

module.exports = draftEmployeeController;

