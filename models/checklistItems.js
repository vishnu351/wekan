ChecklistItems = new Mongo.Collection('checklistItems');

ChecklistItems.attachSchema(new SimpleSchema({
  title: {
    type: String,
  },
  sort: {
    type: Number,
    decimal: true,
  },
  isFinished: {
    type: Boolean,
    defaultValue: false,
  },
  checklistId: {
    type: String,
  },
  cardId: {
    type: String,
  },
}));

ChecklistItems.allow({
  insert(userId, doc) {
    return allowIsBoardMemberByCard(userId, Cards.findOne(doc.cardId));
  },
  update(userId, doc) {
    return allowIsBoardMemberByCard(userId, Cards.findOne(doc.cardId));
  },
  remove(userId, doc) {
    return allowIsBoardMemberByCard(userId, Cards.findOne(doc.cardId));
  },
  fetch: ['userId', 'cardId'],
});

ChecklistItems.before.insert((userId, doc) => {
  if (!doc.userId) {
    doc.userId = userId;
  }
});

// Mutations
ChecklistItems.mutations({
  setTitle(title) {
    return { $set: { title } };
  },
  check(){
    return { $set: { isFinished: true } };
  },
  uncheck(){
    return { $set: { isFinished: false } };
  },
  toggleItem() {
    return { $set: { isFinished: !this.isFinished } };
  },
  move(checklistId, sortIndex) {
    const cardId = Checklists.findOne(checklistId).cardId;
    const mutatedFields = {
      cardId,
      checklistId,
      sort: sortIndex,
    };

    return {$set: mutatedFields};
  },
});

// Activities helper
function itemCreation(userId, doc) {
  const card = Cards.findOne(doc.cardId);
  const boardId = card.boardId;
  Activities.insert({
    userId,
    activityType: 'addChecklistItem',
    cardId: doc.cardId,
    boardId,
    checklistId: doc.checklistId,
    checklistItemId: doc._id,
    checklistItemName:doc.title,
  });
}

function itemRemover(userId, doc) {
  const card = Cards.findOne(doc.cardId);
  const boardId = card.boardId;
  Activities.insert({
    userId,
    activityType: 'removedChecklistItem',
    cardId: doc.cardId,
    boardId,
    checklistId: doc.checklistId,
    checklistItemId: doc._id,
    checklistItemName:doc.title,
  });
  Activities.remove({
    checklistItemId: doc._id,
  });
}

function publishCheckActivity(userId, doc){
  const card = Cards.findOne(doc.cardId);
  const boardId = card.boardId;
  let activityType;
  if(doc.isFinished){
    activityType = 'checkedItem';
  }else{
    activityType = 'uncheckedItem';
  }
  const act = {
    userId,
    activityType,
    cardId: doc.cardId,
    boardId,
    checklistId: doc.checklistId,
    checklistItemId: doc._id,
    checklistItemName:doc.title,
  };
  Activities.insert(act);
}

function publishChekListCompleted(userId, doc){
  const card = Cards.findOne(doc.cardId);
  const boardId = card.boardId;
  const checklistId = doc.checklistId;
  const checkList = Checklists.findOne({_id:checklistId});
  if(checkList.isFinished()){
    const act = {
      userId,
      activityType: 'completeChecklist',
      cardId: doc.cardId,
      boardId,
      checklistId: doc.checklistId,
      checklistName: checkList.title,
    };
    Activities.insert(act);
  }
}

function publishChekListUncompleted(userId, doc){
  const card = Cards.findOne(doc.cardId);
  const boardId = card.boardId;
  const checklistId = doc.checklistId;
  const checkList = Checklists.findOne({_id:checklistId});
  // BUGS in IFTTT Rules: https://github.com/wekan/wekan/issues/1972
  //       Currently in checklist all are set as uncompleted/not checked,
  //       IFTTT Rule does not move card to other list.
  //       If following line is negated/changed to:
  //         if(!checkList.isFinished()){
  //       then unchecking of any checkbox will move card to other list,
  //       even when all checkboxes are not yet unchecked.
  //       What is correct code for only moving when all in list is unchecked?
  // TIPS: Finding  files, ignoring some directories with grep -v:
  //         cd wekan
  //         find . | xargs grep 'count' -sl | grep -v .meteor | grep -v node_modules | grep -v .build
  //       Maybe something related here?
  //         wekan/client/components/rules/triggers/checklistTriggers.js
  if(checkList.isFinished()){
    const act = {
      userId,
      activityType: 'uncompleteChecklist',
      cardId: doc.cardId,
      boardId,
      checklistId: doc.checklistId,
      checklistName: checkList.title,
    };
    Activities.insert(act);
  }
}

// Activities
if (Meteor.isServer) {
  Meteor.startup(() => {
    ChecklistItems._collection._ensureIndex({ checklistId: 1 });
  });

  ChecklistItems.after.update((userId, doc, fieldNames) => {
    publishCheckActivity(userId, doc);
    publishChekListCompleted(userId, doc, fieldNames);
  });

  ChecklistItems.before.update((userId, doc, fieldNames) => {
    publishChekListUncompleted(userId, doc, fieldNames);
  });


  ChecklistItems.after.insert((userId, doc) => {
    itemCreation(userId, doc);
  });

  ChecklistItems.after.remove((userId, doc) => {
    itemRemover(userId, doc);
  });
}

if (Meteor.isServer) {
  JsonRoutes.add('GET', '/api/boards/:boardId/cards/:cardId/checklists/:checklistId/items/:itemId', function (req, res) {
    Authentication.checkUserId( req.userId);
    const paramItemId = req.params.itemId;
    const checklistItem = ChecklistItems.findOne({ _id: paramItemId });
    if (checklistItem) {
      JsonRoutes.sendResult(res, {
        code: 200,
        data: checklistItem,
      });
    } else {
      JsonRoutes.sendResult(res, {
        code: 500,
      });
    }
  });

  JsonRoutes.add('PUT', '/api/boards/:boardId/cards/:cardId/checklists/:checklistId/items/:itemId', function (req, res) {
    Authentication.checkUserId( req.userId);

    const paramItemId = req.params.itemId;

    if (req.body.hasOwnProperty('isFinished')) {
      ChecklistItems.direct.update({_id: paramItemId}, {$set: {isFinished: req.body.isFinished}});
    }
    if (req.body.hasOwnProperty('title')) {
      ChecklistItems.direct.update({_id: paramItemId}, {$set: {title: req.body.title}});
    }

    JsonRoutes.sendResult(res, {
      code: 200,
      data: {
        _id: paramItemId,
      },
    });
  });

  JsonRoutes.add('DELETE', '/api/boards/:boardId/cards/:cardId/checklists/:checklistId/items/:itemId', function (req, res) {
    Authentication.checkUserId( req.userId);
    const paramItemId = req.params.itemId;
    ChecklistItems.direct.remove({ _id: paramItemId });
    JsonRoutes.sendResult(res, {
      code: 200,
      data: {
        _id: paramItemId,
      },
    });
  });
}
