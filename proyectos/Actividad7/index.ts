import * as functions from 'firebase-functions'
import * as i18n from 'i18n'
import * as fs from 'fs'
import * as express from 'express'
import {
  IregistryUser,
  requestGID,
  getUserByAccessToken,
  getUserByUID,
  addCard,
  saveCard,
  deleteCardFromPaymentGateway,
  deleteCard,
  // getTransactionByID,
  savePendingRequest,
  saveTransactionData,
  getPendingRequestByToken,
  removePendingRequest,
  // removeFromRequestOrders,
  updateFromRequestOrders,
  removeBankAccountNumber,
  saveTransactionDataFromRequestOrdersToUserHistory,
  ITransactionHistory,
  IrequestResponse,
  IcardData,
  ICardRequestData,
  ICommerceData,
  IPendingRequest,
  IBankAccountData,
  IUpdateCommerceData,
  INotification,
  getUserDataByAttrib,
  getUser,
  capitalizeFirstLetter,
  getCommerceByUID
} from './src/utils'

import {
  successResponse,
  errorResponse,
} from './src/responses'

import {
  users,
  accessToken,
  resetToken,
  commerce,
  transactionLog,
  userHistory,
  pendingOrder,
  issues,
  userBlacklist,
  transactionHistory,
  operators,
  systemSettings
} from './src/database'

import {
  saveSentNotificationsByAdmin,
  pushNotificationSender,
  createUserNotification
} from './src/notification'

import {
  makeGualyPayment
} from './src/gualyPaymentGateway'

import {
  saveMoneyRequest,
  proccessMoneyRequest,
  createWithdraw,
  processPendingWithdraw,
  getTransacionData,
  saveTransaction,
  addAmount,
  createDeposit,
  proccessSendMoney,
  updateTransactionToUserHistory
} from './src/transaction'

import { createUser, deleteUser, updateUser, IcreateUser } from './src/firebase'
import { auth, database } from 'firebase-admin'
import {
  productionMode,
  gualyPaymentGateway,
  infoEmail,
  lang,
  clientAddress
} from './config/constants'
import { SendGridService } from './src/email_services/SendGrid'
import * as httpStatus from 'http-status-codes'
import { TokenGenerator } from './src/services'
import * as googleCloudStorage from '@google-cloud/storage'
const gcs = googleCloudStorage({ keyFilename: 'gualy-b39cb-firebase-adminsdk-rn6je-72b3b7d76f.json' })
import { spawn } from 'child-process-promise'
import * as mimeTypes from 'mimetypes'
import {
  updateUserData,
  getResetPasswordDataByToken,
  IResetToken,
  IUserData,
  removeToken,
  addBankAccountToUser
} from './src/users'
// import { getCommerceData } from './src/commerce'
import { UserRecord } from 'firebase-functions/lib/providers/auth';

import * as moment from 'moment'
import * as momentTz from 'moment-timezone'
import * as CCType from 'credit-card-type'
import { nearbyCommerces } from './src/commerce';
import { depositKpi } from './deposit'
import { balanceFromToday, balanceFromYesterday, balanceFromCurrentWeek, balanceFromLastWeek, balanceFromCurrentMonth, balanceFromLastMonth, balanceFromCurrentYear, balanceFromLastYear } from "./balance"
import { makeNewIssue, updateIssue, IAttachmentData, IIssueData, handleAssingAgent, handleRemoveAgent, handleUpdateIssueStatus, handlePublicateIssueAnswer } from './src/issue'
import { withdrawKpi } from './withdraw'
import { numberTransaction } from './number_transactions'
import { daysAgoReport } from './commerce_evolution'
import { activityTransferPurchase } from './transfer_purchase'
import { usersKPI } from './user_report'
import { userVsCommerce } from './activity_user_commerce'
import { checkGualyHistory, saveNewGualyHistory, updateGualyHistory } from './src/gualyReport'
const admin = require('firebase-admin');
i18n.configure({
  defaultLocale: 'es',
  directory: './locales',
  locales: ['es'],
})

// custom log middleware
const whichMethodLog = (req, res, next) => {
  console.log(`${req.originalUrl} REQUEST body: ${JSON.stringify(req.body, null, 2)}`)
  next()
}

const logResponseBody = (req, res, next) => {
  const oldWrite = res.write;
  const oldEnd = res.end;

  const chunks = [];

  res.write = (...restArgs) => {
    chunks.push(new Buffer(restArgs[0]));
    oldWrite.apply(res, restArgs);
  };
  // When the stream ends log the response
  res.end = (...restArgs) => {
    if (restArgs[0]) {
      chunks.push(new Buffer(restArgs[0]));
    }
    const resBody = Buffer.concat(chunks).toString('utf8');
    console.log(`${req.originalUrl} RESPONSE body: ${JSON.stringify(JSON.parse(resBody), null, 2)}`)

    oldEnd.apply(res, restArgs);
  }
  next()
}

// Express
import * as cors from 'cors'
// import * as morgan from 'morgan'
const app = express()
app.use(cors({ origin: true }))
app.use(whichMethodLog)
app.use(logResponseBody)

const twitter = 'https://twitter.com/gualyapp'
const facebook = 'https://www.facebook.com/Gualy-App-1963067283978287/'
const instagram = 'https://www.instagram.com/gualyapp/'
const deepLink = 'https://app.gualy.com/'
const ayuda = 'https://gualy.com/#contacto'
const faq = 'https://gualy.com/preguntas-frecuentes/'
const condiciones = 'https://gualy.com/terminos-y-condiciones/'
const previewText = 'previewText'
const supportEmail = 'soporte@gualy.com'
const acceptMoneyRequestDeepLink = 'https://app.gualy.com/'
const rejectMoneyRequestDeepLink = 'https://app.gualy.com/'
const deepLinkUnsecureDevice = 'https://app.gualy.com/'
const landingPage = 'https://app.gualy.com/'
const callCenterNumber = '02618085657'

// UTILS
interface IGualyPaymentResponse {
  userId?: string,
  publicKey?: string,
  type: string,
  transactionDay: string,
  transactionHour: string,
  timeZone: string,
  transactionAmount: number,
  userAmountBeforeTransaction?: number,
  userAmountAfterTransaction?: number,
  description: string,
  paymentType?: string,
  success: boolean,
  error?: string,
  reason?: string,
  reference?: string,
  instaPagoDateTime: string,
  transactionKey: string,
  card?: string,
  cardToken?: string,
  bank?: string
  instaPagoTransactionID: string,
  done: boolean
}
interface IAttachments {
  name?: string,
  base64Img?: string,
  comment?: string
}

async function uploadProfilePicture(uid: string, image: string, admin?: boolean, userType?: string): Promise<any> {
  const mimeType = image.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/)[1]
  const fileName = `${Date.now()}.${mimeTypes.detectExtension(mimeType)}`
  const base64EncodedImageString = image.split(/,(.+)/)[1]
  const imageBuffer = new Buffer(base64EncodedImageString, 'base64')
  console.log('Uploading img')
  console.log(fileName)
  // Instantiate the GCP Storage instance
  const bucket = gcs.bucket('gualy-b39cb.appspot.com')

  // Upload the image to the bucket
  const file = bucket.file(`profiles/${uid}/${fileName}`)
  await file.save(imageBuffer, {
    metadata: {
      contentType: mimeType
    },
    public: true,
    validation: 'md5'
  })
  const config = {
    action: 'read',
    expires: '03-09-2021'
  }
  console.log('Get signed url')
  const promesa = await file.getSignedUrl(config)
  const profilePicture = promesa[0]
  console.log(profilePicture)
  let checkAccessToken: database.DataSnapshot = await accessToken.child(uid).once('value')
  if (checkAccessToken.exists()) {
    await accessToken.child(uid).update({ profilePicture })
  } else {
    await users.child(uid).update({ profilePicture })
    if (admin) {
      if (userType === 'commerce') {
        await commerce.child(uid).update({ profilePicture })
      }
    }
  }
  return profilePicture
}
export async function uploadIssueImage(image: string, name: string, uid: string, path: string, attachmentsToSave: IAttachmentData): Promise<any> {
  console.log(`UploadImage Function`)
  const mimeType = image.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/)[1]
  const fileName = name + '.' + mimeTypes.detectExtension(mimeType)
  const base64EncodedImageString = image.split(/,(.+)/)[1]
  const imageBuffer = new Buffer(base64EncodedImageString, 'base64')
  console.log('Uploading img')
  console.log(fileName)
  // Instantiate the GCP Storage instance
  const bucket = gcs.bucket('gualy-b39cb.appspot.com')

  // Upload the image to the bucket
  const file = bucket.file(`brochure/${path}/${fileName}`)
  console.log(`full path brochure/${path}/${fileName}`)
  await file.save(imageBuffer, {
    metadata: {
      contentType: mimeType
    },
    public: true,
    validation: 'md5'
  })
  const config = {
    action: 'read',
    expires: '03-09-2021'
  }
  console.log('Get signed url')
  const promesa = await file.getSignedUrl(config)
  const profilePicture = promesa[0]
  console.log(profilePicture)
  let toSave = []
  attachmentsToSave.url = profilePicture
  toSave.push(attachmentsToSave)
  updateIssue(uid, { attachments: toSave })
  return profilePicture
}
async function requestGeneratePasswordToken(uid) {
  let snapshot: database.DataSnapshot
  let passwordToken: string
  let user: IUserData
  try {
    snapshot = await getUserByUID(uid)
    if (!snapshot.exists()) {
      return i18n.__('ERROR:UID_NOT_FOUND')
    }
    user = snapshot.val()
    if (user.passwordToken) {
      return i18n.__('ERROR:MAX_ALLOWED_ATTEMPTS')
    }
    passwordToken = TokenGenerator.generateTokenB64(20)
    await updateUserData(uid, { passwordToken })
    await resetToken.child(passwordToken).set({ uid, passwordToken })
    let sg = new SendGridService()
    await sg.send('Gualy', infoEmail, [user.email], 'Recuperar contraseña', 'recuperar contraseña')
    return 'Success'
  } catch (error) {
    return error.message
  }
}

// ROUTES
export const handleAddUser = async (req, res) => {
  let { ...registryUser }: IregistryUser = req.body
  registryUser.privateKey = gualyPaymentGateway.private
  let requestResponse: IrequestResponse
  let createUserData: IcreateUser
  let createUserResponse: auth.UserRecord
  let uid: string
  console.log('Data del usuario', registryUser)
  try {
    createUserData = {
      email: registryUser.email,
      emailVerified: false,
      phoneNumber: registryUser.phone,
      password: registryUser.password,
      displayName: `${registryUser.firstName} ${registryUser.lastName}`,
      //photoURL: registryUser.profileImgURI,
      disabled: false

    }
    console.log('create user')
    createUserResponse = await createUser(createUserData)
    uid = createUserResponse.uid
    console.log('requesting gid on gualy payment gateway', registryUser)
    requestResponse = await requestGID(registryUser)
    console.log('after request')
    console.log(requestResponse)
    if (!requestResponse.success) {
      console.log('hubo un error pidiendo un gid', requestResponse)
      await deleteUser(uid)
      return res.json(errorResponse({
        message: requestResponse.error.message
      }))
    }
    console.log(`check production mode for email ${productionMode}`)
    if (productionMode && registryUser.type !== 'commerce') {
      let url: string = `${clientAddress}?token=${uid}`;
      let templatePath = `${__dirname}/emailTemplates/verificationEmail.html`
      let fileBuffer = fs.readFileSync(templatePath)
      let sg: SendGridService = new SendGridService()
      await sg.send('GUALY', infoEmail, [registryUser.email], i18n.__('LABEL:VERIFY_YOUR_EMAIL'), fileBuffer.toString(), { "%url%": url, "%username%": registryUser.name })
    }
    let defaultQuestion = '-L7dVjrkLpwavHFYON77'
    let defaultAnswer = 'default'
    let createdAt = momentTz.tz('America/Caracas').format('YYYY-MM-DD')
    let args: IUserData = {
      name: registryUser.type === 'commerce' ? registryUser.name : `${registryUser.firstName} ${registryUser.lastName}`,
      firstName: registryUser.firstName,
      lastName: registryUser.lastName,
      phone: registryUser.phone,
      email: registryUser.email,
      lang: 'es',
      dni: {
        type: registryUser.idType,
        id: registryUser.idNumber
      },
      amount: 0,
      createdAt,
      userKey: uid,
      gID: requestResponse.metadata.gID,
      creditCard: false,
      bankAccount: false,
      questions: {
        [`${registryUser.questionKey || defaultQuestion}`]: {
          answer: registryUser.securityAnswer || defaultAnswer,
          questionKey: registryUser.questionKey || defaultQuestion,
          defaultQuestion: true
        }
      },
      type: registryUser.type || '',
      commerceName: registryUser.type === 'commerce' ? registryUser.commerceName : null,
      address: registryUser.address || null,
      commerceLatitude: registryUser.type === 'commerce' ? registryUser.latitude : null,
      commerceLongitude: registryUser.type === 'commerce' ? registryUser.longitude : null,
      description: registryUser.type === 'commerce' ? registryUser.description : null,
      verificationFlag: false,
      deviceUniqueToken: req.body.deviceUniqueToken,
      secureDevices: [req.body.deviceUniqueToken],
      notificationFlag: false,
      createdTimestamp: database.ServerValue.TIMESTAMP
    }
    console.log('checkRegistry data')
    console.log(args)
    await accessToken.child(uid).set(args)
    console.log('Saved user')
    console.log(registryUser.profileImgURI)
    let profilePhotoURI = await uploadProfilePicture(uid, registryUser.profileImgURI)
    console.log('profile pho uri response')
    console.log(profilePhotoURI)
    await updateUser(uid, { photoURL: profilePhotoURI })
    console.log('updated firebase user')
    return res.json(successResponse({
      message: requestResponse.data.message
    }))
  } catch (error) {
    if (error.code === 'auth/email-already-exists') {
      return res.json(errorResponse({
        message: i18n.__('VALIDATION:USER_EMAIL_ALREADY_EXISTS')
      }))
    }
    if (error.code === 'auth/invalid-email') {
      return res.json(errorResponse({
        message: i18n.__('VALIDATION:EMAIL_ADDRESS_IMPROPERLY_FORMATTED')
      }))
    }
    if (error.code === 'auth/user-not-found') {
      return res.json(errorResponse({
        message: i18n.__('ERROR:UID_NOT_FOUND')
      }))
    }
    if (error.code === 'auth/phone-number-already-exists') {
      return res.json(errorResponse({
        message: i18n.__('VALIDATION:USER_PHONE_ALREADY_EXISTS')
      }))
    }
    console.log('error: ', error)
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }, error))
  }
}
app.post('/addUser', handleAddUser)

export const handleAddUserByAdmin = async (req, res) => {
  let registryUser: IregistryUser = req.body
  console.log('body')
  console.log(req.body)
  let adminID: string = req.body.adminID
  let lat: string = req.body.latitude
  let lon: string = req.body.longitude
  let contactIdType = req.body.contactIdType
  let contactIdNumber = req.body.contactIdNumber
  let corporateName = req.body.corporateName
  let bankPicture = req.body.bankPicture
  registryUser.privateKey = gualyPaymentGateway.private
  let requestResponse: IrequestResponse
  let createUserData: IcreateUser
  let createUserResponse: auth.UserRecord
  let uid: string
  let adminSnapshot: database.DataSnapshot
  console.log('Data del usuario', registryUser)
  try {
    adminSnapshot = await getUserByUID(adminID)
    if (!adminSnapshot) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:ADMIN_UID_NOT_FOUND')
      }))
    }
    let password = TokenGenerator.generateTokenB64(6)
    createUserData = {
      email: registryUser.email,
      emailVerified: registryUser.type === 'commerce',
      phoneNumber: registryUser.phone,
      password: registryUser.type === 'commerce' ? password : registryUser.password,
      displayName: registryUser.name || `${registryUser.firstName} ${registryUser.lastName}`,
      //photoURL: registryUser.profileImgURI,
      disabled: false

    }
    console.log('create user')
    console.log(createUserData)
    createUserResponse = await createUser(createUserData)
    uid = createUserResponse.uid
    console.log('requesting gid on gualy payment gateway', registryUser)
    requestResponse = await requestGID(registryUser)
    console.log('after request')
    console.log(requestResponse)
    if (!requestResponse.success) {
      console.log('hubo un error pidiendo un gid', requestResponse)
      await deleteUser(uid)
      return res.json(errorResponse({
        message: requestResponse.error.message
      }))
    }
    console.log(`check production mode for email ${productionMode}`)
    if (productionMode && registryUser.type !== 'commerce') {
      let url: string = `${clientAddress}?token=${uid}`
      let templatePath = `${__dirname}/emailTemplates/welcomeEmail.html`
      let fileBuffer = fs.readFileSync(templatePath)
      let sg: SendGridService = new SendGridService()
      await sg.send('GUALY', infoEmail, [registryUser.email], i18n.__('LABEL:VERIFY_YOUR_EMAIL'), fileBuffer.toString(), { "%url%": url, "%username%": registryUser.name })
    }
    let createdAt = momentTz.tz('America/Caracas').format('YYYY-MM-DD')
    let args: IUserData = {
      name: registryUser.type === 'commerce' ? registryUser.name : `${registryUser.firstName} ${registryUser.lastName}`,
      firstName: registryUser.firstName,
      lastName: registryUser.lastName,
      phone: registryUser.phone,
      email: registryUser.email,
      lang: 'es',
      dni: {
        type: registryUser.idType,
        id: registryUser.idNumber
      },
      amount: 0,
      createdAt,
      userKey: uid,
      gID: requestResponse.metadata.gID,
      creditCard: false,
      bankAccount: false,
      type: registryUser.type || '',
      commerceName: registryUser.type === 'commerce' ? registryUser.name : null,
      address: registryUser.type === 'commerce' ? registryUser.address : null,
      commerceLatitude: registryUser.type === 'commerce' ? registryUser.latitude : null,
      commerceLongitude: registryUser.type === 'commerce' ? registryUser.longitude : null,
      description: registryUser.type === 'commerce' ? registryUser.description : null,
      verificationFlag: false,
      deviceUniqueToken: req.body.deviceUniqueToken,
      secureDevices: [req.body.deviceUniqueToken],
      notificationFlag: false,
      isPasswordSettedByUser: false,
      setPasswordAt: '',
      createdTimestamp: database.ServerValue.TIMESTAMP
    }
    console.log('checkRegistry data')
    console.log(args)
    if (registryUser.type === 'commerce') {
      await users.child(uid).set(args)
      let commerceData: ICommerceData = {
        commerceKey: uid,
        address: registryUser.address,
        commerceRegisterId: {
          id: registryUser.idType,
          type: registryUser.idNumber
        },
        email: registryUser.email,
        name: registryUser.name,
        description: registryUser.description,
        corporateName,
        contactData: {
          contactId: {
            contactIdNumber,
            contactIdType
          },
          contactName: `${registryUser.firstName} ${registryUser.lastName}`
        },
        phone: registryUser.phone,
        lat,
        lon
      }
      await commerce.child(uid).set(commerceData)
      let bankAccountData: IBankAccountData = {
        bankAccountNumber: registryUser.bankAccount,
        name: corporateName,
        dni: {
          id: registryUser.idNumber,
          type: registryUser.idType
        },
        email: registryUser.email,
        phone: registryUser.phone,
        uid,
        bankPicture: bankPicture || ''
      }
      await addBankAccountToUser(uid, bankAccountData)
    } else {
      await accessToken.child(uid).set(args)
    }
    console.log('Saved user')
    console.log(registryUser.profileImgURI)
    let profilePhotoURI = await uploadProfilePicture(uid, registryUser.profileImgURI)
    if (registryUser.type === 'commerce') {
      let templatePath = `${__dirname}/emailTemplates/commerceWelcome.html`
      let fileBuffer = fs.readFileSync(templatePath)
      let sg = new SendGridService()
      let subject = i18n.__('LABEL:WELCOME_TO_GUALY')
      await sg.send(
        'Gualy',
        infoEmail,
        [registryUser.email],
        subject,
        fileBuffer.toString(),
        {
          '%username%': registryUser.name,
          '%subject%': subject,
          '%deepLink%': registryUser.type === 'commerce' ? 'https://gualy-b39cb.firebaseapp.com/' : deepLink,
          '%email%': registryUser.email,
          '%password%': password,
          '%landingPage%': landingPage,
          '%profilePicture%': profilePhotoURI,
          '%ayuda%': ayuda,
          '%faq%': faq,
          '%condiciones%': condiciones,
          '%facebook%': facebook,
          '%twitter%': twitter,
          '%instagram%': instagram,
          '%previewText%': previewText,
          '%supportEmail%': supportEmail
        }
      )
    }
    console.log('profile pho uri response')
    console.log(profilePhotoURI)
    await updateUser(uid, { photoURL: profilePhotoURI })
    console.log('updated firebase user')
    return res.json(successResponse({
      message: requestResponse.data.message
    }))
  } catch (error) {

    if (error.code === 'auth/email-already-exists') {
      return res.json(errorResponse({
        message: i18n.__('VALIDATION:USER_EMAIL_ALREADY_EXISTS')
      }))
    }
    if (error.code === 'auth/invalid-email') {
      return res.json(errorResponse({
        message: i18n.__('VALIDATION:EMAIL_ADDRESS_IMPROPERLY_FORMATTED')
      }))
    }
    if (error.code === 'auth/user-not-found') {
      return res.json(errorResponse({
        message: i18n.__('ERROR:UID_NOT_FOUND')
      }))
    }
    if (error.code === 'auth/phone-number-already-exists') {
      return res.json(errorResponse({
        message: i18n.__('VALIDATION:USER_PHONE_ALREADY_EXISTS')
      }))
    }
    console.log('error: ', error)
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }, error))
  }
}
app.post('/addUserByAdmin', handleAddUserByAdmin)

export const handleValidate = async (req, res) => {
  if (req.host === 'POST') {
    return res.json(errorResponse({
      message: i18n.__('ERROR:UNAUTHORIZED_ACCESS')
    }))
  }
  let uid: string = req.query.verificationCode || false
  let snapshot: database.DataSnapshot
  // let redirectLink: string = 'https://i.ytimg.com/vi/GTwIK-vEEKw/maxresdefault.jpg'
  if (!uid) {
    return res.json(errorResponse({
      message: i18n.__('ERROR:MISSING_PARAMETERS')
    }))
  }
  try {
    snapshot = await getUserByAccessToken(uid)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:UID_NOT_FOUND')
      }))
    }
    let user: IUserData = snapshot.val()
    user.verificationFlag = true
    await Promise.all(
      [
        users.child(uid).set(user),
        updateUser(uid, { emailVerified: true }),
        accessToken.child(uid).remove()
      ]
    )

    let templatePath = `${__dirname}/emailTemplates/verifiedEmail.html`
    let fileBuffer = fs.readFileSync(templatePath)
    let sg = new SendGridService()
    await sg.send(
      'Gualy',
      infoEmail,
      [user.email],
      i18n.__('LABEL:SUCCESSFUL_USER_VALIDATION'),
      fileBuffer.toString(),
      {
        '%username%': user.name,
        '%subject%': i18n.__('LABEL:SUCCESSFUL_USER_VALIDATION'),
        '%deepLink%': deepLink,
        '%landingPage%': landingPage,
        '%ayuda%': ayuda,
        '%faq%': faq,
        '%condiciones%': condiciones,
        '%facebook%': facebook,
        '%twitter%': twitter,
        '%instagram%': instagram,
        '%previewText%': previewText,
        '%supportEmail%': supportEmail
      }
    )
    return res.json(successResponse({
      message: i18n.__('MESSAGE:SUCCESSFUL_USER_VALIDATION')
    }))
  } catch (error) {
    console.log(error)
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.get('/validate', handleValidate)

export const handleAddCreditCard = async (req, res) => {
  let publicKey: string = req.body.gualyKey
  let cardNumber: string = req.body.cardNumber
  let expirationDate: string = req.body.expirationDate
  let uid: string = req.body.userID
  let cvv2: string = req.body.cvv
  let connectionIp: string = req.host
  let privateKey: string = gualyPaymentGateway.private
  let snapshot: database.DataSnapshot
  let userID: string
  let addCardData: ICardRequestData
  let requestResponse: IrequestResponse
  let cardData: IcardData
  console.log('El body')
  console.log(req.body)
  try {

    if (!publicKey || cardNumber.length < 12 || cardNumber.length >= 17 || !expirationDate || !uid || !cvv2) {
      return res.json(errorResponse({
        message: i18n.__('INVALID_PARAMETERS')
      }))
    }

    snapshot = await getUserByUID(uid)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:UID_NOT_FOUND')
      }))
    }
    let user: IUserData = snapshot.val()
    userID = user.gID
    addCardData = {
      publicKey,
      privateKey,
      cardNumber,
      cvv2,
      connectionIp,
      expirationDate,
      userID
    }

    requestResponse = await addCard(addCardData)
    if (!requestResponse.success) {
      console.log('hubo un error agregando la tarjeta', requestResponse)
      return res.json(errorResponse({
        message: requestResponse.error.message
      }))
    }

    let cardType = CCType(cardNumber)[0].niceType || 'Default'

    cardData = {
      banned: false,
      blocked: false,
      cardID: requestResponse.metadata.cID,
      lastFourDigits: cardNumber.substr(-4),
      cardType
    }
    const response = await saveCard(uid, cardData)
    return res.json(successResponse({
      message: i18n.__('MESSAGE:CREDIT_CARD_ADDED'),
      response
    }))
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/addCreditCard', handleAddCreditCard)

export const handleDeleteCreditCard = async (req, res) => {

  let publicKey: string = req.body.publicKey
  let privateKey: string = gualyPaymentGateway.private
  let userID: string = req.body.userID //gID
  let cardID: string = req.body.cardID //cID
  let cardData: ICardRequestData
  let requestResponse: IrequestResponse
  console.log('vars', req.body)
  console.log(publicKey)
  console.log(userID)
  console.log(cardID)
  try {

    cardData = {
      cardID,
      privateKey,
      publicKey,
      userID,
    }
    console.log('cardData', cardData)
    requestResponse = await deleteCardFromPaymentGateway(cardData)
    console.log('after delete request card')
    console.log(requestResponse)
    if (!requestResponse.success) {
      console.log('hubo un error borrando la tarjeta del gateway', requestResponse)
      return res.json(errorResponse({
        message: requestResponse.error.message
      }))
    }
    await deleteCard(userID, cardID)
    console.log('deleted card')


    return res.json(successResponse({
      message: i18n.__('MESSAGE:CREDIT_CARD_DELETED')
    }))

  } catch (error) {
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/deleteCreditCard', handleDeleteCreditCard)

export const handleTestRequestOrder = async (req, res) => {
  let language = req.body.lang || lang
  moment.locale(language)
  let data: ITransactionHistory = req.body
  try {
    let dateFormat = capitalizeFirstLetter(moment(data.date).format('MMM DD'))
    let idTransaction: string = pendingOrder.push().key
    let requestOrderData: ITransactionHistory = {
      amount: data.amount,
      currency: data.currency,
      date: data.date,
      dateFormat,
      dateTime: `${data.date} ${data.time}`,
      description: data.description || '',
      idTransaction,
      senderEmail: data.senderEmail,
      senderProfilePicture: data.senderProfilePicture,
      senderUid: data.senderUid,
      senderUsername: data.senderUsername,
      time: data.time,
      transactionType: 'Receive',
      mode: 'Deposit',
      transactionRelationship: 'U2G',
      userBankAccount: data.userBankAccount,
      gualyBankAccount: data.gualyBankAccount,
      status: 'Pending',
      bankReference: data.bankReference,
      read: false,
      timestamp: database.ServerValue.TIMESTAMP
    }
    await pendingOrder.child(idTransaction).set(requestOrderData)
    return res.json(successResponse({
      message: 'did it'
    }))
  } catch (error) {
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/testRequestOrder', handleTestRequestOrder)

export const handleAddMoneyToGualyByBankAccount = async (req, res) => {
  let uid = req.body.senderUid
  let amount = req.body.amount
  let currency = req.body.currency
  let description = req.body.description
  let date = momentTz.tz('America/Caracas').format('YYYY-MM-DD')
  let time = momentTz.tz('America/Caracas').format('HH:mm:ss')
  let userBankAccount = req.body.userBankAccount
  let gualyBankAccount = req.body.gualyBankAccount
  let bankReference = req.body.bankReference
  let language = req.body.lang || lang
  moment.locale(language)
  let snapshot: database.DataSnapshot
  let user: IUserData
  try {
    snapshot = await getUserByUID(uid)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:UID_NOT_FOUND')
      }))
    }
    user = snapshot.val()
    let dateFormat = capitalizeFirstLetter(moment(date).format('MMM DD'))
    let pendingOrderData: ITransactionHistory = {
      amount,
      currency,
      date,
      dateFormat,
      dateTime: `${date} ${time}`,
      description: description || '',
      idTransaction: '',
      senderEmail: user.email,
      senderProfilePicture: user.thumbnail || user.profilePicture || '',
      senderUid: uid,
      senderUsername: user.name,
      receiverEmail: user.email,
      receiverProfilePicture: user.thumbnail || user.profilePicture || '',
      receiverUid: uid,
      receiverUsername: user.name,
      time,
      transactionType: 'Receive',
      mode: 'Deposit',
      userBankAccount,
      gualyBankAccount,
      status: 'Pending',
      bankReference,
      source: 'toUser',
      transactionRelationship: 'U2G',
      read: false,
      timestamp: database.ServerValue.TIMESTAMP
    }
    let createDepositResponse = await createDeposit(uid, pendingOrderData)
    if (!createDepositResponse.success) {
      console.log('Error at addMoneyToGualyByBankAccount. Error:')
      console.log(createDepositResponse.error)
      return res.json(errorResponse({
        message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: createDepositResponse.error })
      }))
    }
    let pendingDeposit = 0
    if (user.pendingDeposit) {
      pendingDeposit = addAmount(user.pendingDeposit.toString(), amount.toString())
    } else {
      pendingDeposit = amount
    }
    await updateUserData(uid, { pendingDeposit })
    let templatePath = `${__dirname}/emailTemplates/receivedBankTransfer.html`
    let fileBuffer = fs.readFileSync(templatePath)
    let sg = new SendGridService()
    await sg.send(
      'Gualy',
      infoEmail,
      [user.email],
      i18n.__('LABEL:RECEIVED_DEPOSIT_NOTIFICATION'),
      fileBuffer.toString(),
      {
        '%username%': user.name,
        '%subject%': i18n.__('LABEL:RECEIVED_DEPOSIT_NOTIFICATION'),
        '%transactionId%': bankReference,
        '%date%': `${date} ${time}`,
        '%deepLink%': deepLink,
        '%ayuda%': ayuda,
        '%faq%': faq,
        '%condiciones%': condiciones,
        '%facebook%': facebook,
        '%twitter%': twitter,
        '%instagram%': instagram,
        '%previewText%': previewText,
        '%supportEmail%': supportEmail
      }
    )

    return res.json(successResponse({
      message: i18n.__('MESSAGE:PENDING_BANK_DEPOSIT_TRANSFER')
    }))
  } catch (error) {
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/addMoneyToGualyByBankAccount', handleAddMoneyToGualyByBankAccount)

export const handleSendPushNotification = async (req, res) => {
  console.log('body')
  console.log(req.body)
  const { ...hola } = req.body
  console.log('hola')
  console.log(hola)
  const adminID: string = req.body.adminID
  const uids: string = req.body.uids
  const message: string = req.body.message
  // const date: string = req.body.date
  // const time: string = req.body.time
  const timestamp = Date.now()
  const date = momentTz.tz('America/Caracas').format('YYYY-MM-DD')
  const time = momentTz.tz('America/Caracas').format('HH:mm:ss')
  const pushType = req.body.pushType === 'client' || req.body.pushType === 'commerce' || req.body.pushType === 'bulk' ? req.body.pushType : false
  if (!adminID && !message && !date && !time) {
    return res.json(errorResponse({
      message: i18n.__('INVALID_PARAMETERS')
    }))
  }
  let adminSnapshot: database.DataSnapshot
  let adminData: IUserData
  try {

    adminSnapshot = await getUserByUID(adminID)
    if (!adminSnapshot) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:ADMIN_UID_NOT_FOUND')
      }))
    }
    adminData = adminSnapshot.val()
    let uidsArray: string[] = []
    let userKeys: string[] = []
    let userDataToSend = []
    let usersType: any = []
    const clientConst = 'client'
    const commerceConst = 'commerce'
    if (pushType) {
      let snapshot
      if (pushType === 'bulk') {
        snapshot = await getUser()
      } else {
        snapshot = await getUserDataByAttrib('type', pushType)
      }
      let data = snapshot.val()
      for (const key in data) {
        if (data.hasOwnProperty(key)) {
          const user: IUserData = data[key];
          if (user.FCMToken) {
            userKeys.push(user.userKey)
            userDataToSend.push({
              name: user.name,
              profilePicture: user.thumbnail || user.profilePicture || '',
              userKey: user.userKey,
              email: user.email,
              phone: user.phone
            })
          }
        }
      }
      console.log('uids')
      console.log(uidsArray)
      pushType === 'bulk' ? usersType.push(clientConst, commerceConst) : usersType.push(pushType)
    } else {
      console.log('not pushType')
      uidsArray = uids.split(',')
      console.log('uids')
      console.log(uidsArray)
      const usersPromise: Array<Promise<database.DataSnapshot>> = []
      while (uidsArray.length) {
        const uid = uidsArray.splice(0, 1)[0]
        usersPromise.push(users.child(uid).once('value'))
      }
      const usersData: database.DataSnapshot[] = await Promise.all(usersPromise)
      usersData.forEach((snapshot) => {
        const user: IUserData = snapshot.val()
        console.log('Users')
        console.log(user)
        if (user.FCMToken) {
          userKeys.push(user.userKey)
          userDataToSend.push({
            name: user.name,
            profilePicture: user.thumbnail || user.profilePicture || '',
            userKey: user.userKey,
            email: user.email,
            phone: user.phone
          })
          console.log('usersType')
          console.log(usersType)
          if (!usersType.includes(user.type)) {
            usersType.push(user.type)
          }
        }
      })
    }
    console.log('usersKey')
    console.log(userKeys)
    let pushResult = await pushNotificationSender(userKeys, 'Gualy', message, {}, 'notification')

    if (pushResult) {
      let data: INotification = {
        body: message,
        bulkNotificationFlag: false,
        notificationType: 'notification',
        notificationUID: '',
        title: 'Gualy',
        users: userDataToSend,
        senderEmail: adminData.email,
        senderUsername: adminData.name,
        senderProfilePicture: adminData.thumbnail || adminData.profilePicture || '',
        time,
        timestamp,
        date,
        usersType
      }
      await saveSentNotificationsByAdmin(data)
      return res.json(successResponse({
        message: 'Push Sent',
      }))
    } else {
      return res.json(errorResponse({
        message: 'Failed at sending push notification'
      }))
    }
  } catch (error) {
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/sendPushNotification', handleSendPushNotification)

export const handleUpdateUserInfo = async (req, res) => {
  const changeData: string = req.body.newField
  const toChange: string = req.body.toChange === 'phone' || req.body.toChange === 'password' ? req.body.toChange : 'invalid'
  const pendingRequestID: string = req.body.requestID
  console.log('updateUserInfo params')
  console.log(changeData)
  console.log(toChange)
  console.log(pendingRequestID)
  if (!changeData || !toChange || !pendingRequestID) {
    return res.json(errorResponse({
      message: i18n.__('ERROR:MISSING_PARAMETERS_DATA', { params: `${!changeData ? ' newField.' : ''}${!toChange ? ' toChange.' : ''}${!pendingRequestID ? ' requestID.' : ''}` })
    }))
  }
  if (toChange === 'invalid') {
    return res.json(errorResponse({
      message: i18n.__('INVALID_PARAMETERS')
    }))
  }
  let snapshot: database.DataSnapshot
  let pendingRequestSnapshot: database.DataSnapshot
  let user: IUserData
  let requestData: IPendingRequest
  try {
    console.log('Check request token')
    pendingRequestSnapshot = await getPendingRequestByToken(pendingRequestID)
    if (!pendingRequestSnapshot.exists() && toChange !== 'password') {
      return res.json(errorResponse({
        message: i18n.__('ERROR:MAX_ALLOWED_ATTEMPTS')
      }))
    }
    requestData = pendingRequestSnapshot.val()

    console.log('The request exists')
    snapshot = await getUserByUID(pendingRequestID)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:UID_NOT_FOUND')
      }))
    }
    console.log('The user exists')
    user = snapshot.val()
    let sg = new SendGridService()

    console.log('createPromise')

    // ,
    // sg.send('Gualy', infoEmail, [user.email], 'Información Actualizada', 'Se ha actualizado su número telefónico exitosamente.')
    toChange === 'phone' ? await Promise.all([
      updateUser(pendingRequestID, { phoneNumber: changeData }),
      updateUserData(pendingRequestID, { phone: changeData }),
      removePendingRequest(pendingRequestID)
    ]) : await requestGeneratePasswordToken(pendingRequestID)
    if (toChange === 'phone') {
      await sg.send('Gualy', infoEmail, [user.email], 'Información Actualizada', 'Se ha actualizado su número telefónico exitosamente.')
    }
    return res.json(successResponse({
      message: toChange === 'phone' ? i18n.__('MESSAGE:SUCCESSFUL_CHANGE_USER_DATA', { user: user.name }) : i18n.__('LABEL:EMAIL_HAVE_BEEN_SENT')
    }))
  } catch (error) {
    if (error.code === 'auth/internal-error') {
      await updateUserData(pendingRequestID, { phone: requestData.actualValue })
      return res.json(errorResponse({
        message: i18n.__('VALIDATION:INVALID_PHONE_NUMBER')
      }))
    }
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/updateUserInfo', handleUpdateUserInfo)

export const handleRequestUpdateUserInfo = async (req, res) => {
  // aqui hacer el cambio de contrase;a
  const uid = req.body.uid
  const phone = req.body.phone
  const { }: IUpdateCommerceData = req.body
  let snapshot: database.DataSnapshot
  let user: IUserData
  try {
    snapshot = await getUserByUID(uid)
    if (!snapshot.exists()) {
      return i18n.__('ERROR:UID_NOT_FOUND')
    }
    user = snapshot.val()
    await savePendingRequest(uid, {
      uid,
      requestType: 'phone',
      newValue: phone,
      actualValue: user.phone
    })
    return res.json(successResponse({
      message: 'success'
    }))
  } catch (error) {
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/requestUpdateUserInfo', handleRequestUpdateUserInfo)

export const handleGeneratePasswordTokenByEmail = async (req, res) => {
  let email = req.body.email
  let snapshot: database.DataSnapshot
  let passwordToken: string
  let user: IUserData
  let tokenInfo: { token: string, timestamp: number }
  const timeOut = 60 * 10 * 1000
  try {
    snapshot = await getUserDataByAttrib('email', email)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:UID_NOT_FOUND')
      }))
    }
    let data = snapshot.val()
    let element = []
    for (const key in data) {
      if (data.hasOwnProperty(key)) {
        element.push(data[key])
      }
    }
    user = element[0]
    console.log('user')
    /* console.log(user) */
    console.log('timeout > ', (Date.now() + timeOut))
    if (user.passwordToken) {
      console.log("passwordToken Existe")
      // El passwordToken ya existe para ese usuario 
      if (user.passwordToken.timestamp < Date.now()) {
        console.log("passwordToken Expiro")
        // El passwordToken expiro, se generara uno nuevo
        users.child(user.userKey).child('passwordToken').remove()
        updateUserData(user.userKey, { 'passwordToken': null })
        await removeToken(user.passwordToken.token)
        passwordToken = TokenGenerator.generateTokenB64(20)
        tokenInfo = { token: passwordToken, timestamp: (Date.now() + timeOut) }
        console.log('token: ', passwordToken)
        console.log('uid: ', user.userKey)
        await updateUserData(user.userKey, { 'passwordToken': tokenInfo })
        await resetToken.child(passwordToken).set({ timestamp: (Date.now() + timeOut), uid: user.userKey, passwordToken })
      } else {
        console.log("passwordToken aun es valido")
        // El password token ya existente aun es valido, se va a reenviar el correo.
        passwordToken = user.passwordToken.token
      }
    } else {
      console.log("passwordToken No existe previamente")
      // El passwordToken no existe para ese usuario
      passwordToken = TokenGenerator.generateTokenB64(20)
      tokenInfo = { token: passwordToken, timestamp: (Date.now() + timeOut) }
      console.log('token: ', passwordToken)
      console.log('uid: ', user.userKey)
      await updateUserData(user.userKey, { 'passwordToken': tokenInfo })
      await resetToken.child(passwordToken).set({ timestamp: (Date.now() + timeOut), uid: user.userKey, passwordToken })
    }
    let sg = new SendGridService()
    let templatePath = `${__dirname}/emailTemplates/restorePassword.html`
    let url = `${clientAddress}?forgot=${passwordToken}`
    let fileBuffer = fs.readFileSync(templatePath)
    await sg.send(
      'Gualy',
      infoEmail,
      [user.email],
      i18n.__('LABEL:RESTORE_PASSWORD'),
      fileBuffer.toString(),
      {
        "%username%": user.name,
        "%useremail%": user.email,
        '%subject%': i18n.__('LABEL:RESTORE_PASSWORD'),
        '%deepLink%': deepLink,
        '%ayuda%': ayuda,
        '%faq%': faq,
        '%condiciones%': condiciones,
        '%facebook%': facebook,
        '%twitter%': twitter,
        '%instagram%': instagram,
        '%previewText%': previewText,
        '%url%': url,
        '%supportEmail%': supportEmail
      }
    )
    return res.json(successResponse({
      message: 'Success'
    }))
  } catch (error) {
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/generatePasswordTokenByEmail', handleGeneratePasswordTokenByEmail)

export const handleGeneratePasswordToken = async (req, res) => {
  let uid = req.body.uid
  let snapshot: database.DataSnapshot
  let passwordToken: string
  let user: IUserData
  try {
    snapshot = await getUserByUID(uid)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:UID_NOT_FOUND')
      }))
    }
    user = snapshot.val()
    if (user.passwordToken) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:MAX_ALLOWED_ATTEMPTS')
      }))
    }
    passwordToken = TokenGenerator.generateTokenB64(20)
    await updateUserData(uid, { passwordToken })
    await resetToken.child(passwordToken).set({ uid, passwordToken })
    let sg = new SendGridService()
    let url = `${clientAddress}/password-cambio?token=${passwordToken}`
    let templatePath = `${__dirname}/emailTemplates/restorePassword.html`
    let fileBuffer = fs.readFileSync(templatePath)
    await sg.send(
      'Gualy',
      infoEmail,
      [user.email],
      i18n.__('LABEL:RESTORE_PASSWORD'),
      fileBuffer.toString(),
      {
        "%username%": user.name,
        "%useremail%": user.email,
        '%subject%': i18n.__('LABEL:RESTORE_PASSWORD'),
        '%deepLink%': deepLink,
        '%ayuda%': ayuda,
        '%faq%': faq,
        '%condiciones%': condiciones,
        '%facebook%': facebook,
        '%twitter%': twitter,
        '%instagram%': instagram,
        '%previewText%': previewText,
        '%url%': url,
        '%supportEmail%': supportEmail
      }
    )
    return res.json(successResponse({
      message: 'Success'
    }))
  } catch (error) {
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/generatePasswordToken', handleGeneratePasswordToken)

export const handleResetPassword = async (req, res) => {
  const newPassword: string = req.body.password
  const token: string = req.body.token
  let tokenInfo: IResetToken
  let snapshot: database.DataSnapshot
  let transaction: Array<Promise<UserRecord | void>> = []
  let user: IUserData
  try {
    snapshot = await getResetPasswordDataByToken(token)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:MAX_ALLOWED_ATTEMPTS')
      }))
    }
    tokenInfo = snapshot.val()
    snapshot = await getUserByUID(tokenInfo.uid)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:UID_NOT_FOUND')
      }))
    }
    if (tokenInfo.timestamp < Date.now()) {
      transaction.push(removeToken(token))
      transaction.push(updateUserData(tokenInfo.uid, { passwordToken: null }))
      await Promise.all(transaction)
      return res.json(errorResponse({
        message: i18n.__('ERROR:INVALID_TOKEN')
      }))
    } else {
      user = snapshot.val()
      transaction.push(updateUser(tokenInfo.uid, { password: newPassword }))
      transaction.push(updateUserData(tokenInfo.uid, { passwordToken: null }))
      transaction.push(removeToken(token))
      await Promise.all(transaction)
      let sg = new SendGridService()
      let templatePath = `${__dirname}/emailTemplates/changedPassword.html`
      let fileBuffer = fs.readFileSync(templatePath)
      sg.send(
        'Gualy',
        infoEmail,
        [user.email],
        i18n.__('MESSAGE:SUCCESSFUL_PASSWORD_RESET'),
        fileBuffer.toString(),
        {
          "%username%": user.name,
          "%useremail%": user.email,
          '%subject%': i18n.__('MESSAGE:SUCCESSFUL_PASSWORD_RESET'),
          '%deepLink%': deepLink,
          '%ayuda%': ayuda,
          '%faq%': faq,
          '%condiciones%': condiciones,
          '%facebook%': facebook,
          '%twitter%': twitter,
          '%instagram%': instagram,
          '%previewText%': previewText,
          '%supportEmail%': supportEmail,
        }
      )
      return res.json(successResponse({
        message: i18n.__('MESSAGE:SUCCESSFUL_PASSWORD_RESET')
      }))
    }
  } catch (error) {
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/resetPassword', handleResetPassword)

export const handleUpdateSecurityData = async (req, res) => {
  console.log('Body')
  console.log(req.body)
  const uid = req.body.uid
  const password = req.body.password
  const questionKey = req.body.questionKey
  const answer = req.body.answer
  if (!uid) {
    return res.json(errorResponse({
      message: i18n.__('INVALID_PARAMETERS')
    }))
  }
  console.log('first check')
  let snapshot: database.DataSnapshot
  let user: IUserData
  try {
    snapshot = await getUserByUID(uid)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:UID_NOT_FOUND')
      }))
    }
    user = snapshot.val()
    console.log(`User: ${user.name}`)
    if (password) {
      console.log('changing password')
      let setPasswordAt = momentTz.tz('America/Caracas').format('YYYY-MM-DD')
      await updateUser(uid, {
        password
      })
      await updateUserData(uid, {
        isPasswordSettedByUser: true,
        setPasswordAt
      })
      console.log('changed password')
      let sg = new SendGridService()
      let templatePath = `${__dirname}/emailTemplates/changedPassword.html`
      let fileBuffer = fs.readFileSync(templatePath)
      await sg.send(
        'Gualy',
        infoEmail,
        [user.email],
        i18n.__('MESSAGE:SUCCESSFUL_PASSWORD_RESET'),
        fileBuffer.toString(),
        {
          "%username%": user.name,
          "%useremail%": user.email,
          '%subject%': i18n.__('MESSAGE:SUCCESSFUL_PASSWORD_RESET'),
          '%callcenterNumber%': callCenterNumber,
          '%deepLink%': deepLink,
          '%ayuda%': ayuda,
          '%faq%': faq,
          '%condiciones%': condiciones,
          '%facebook%': facebook,
          '%twitter%': twitter,
          '%instagram%': instagram,
          '%previewText%': previewText,
          '%supportEmail%': supportEmail
        }
      )
    }
    if (questionKey && answer) {
      console.log('changing security question')
      await updateUserData(uid, {
        questions: {
          [`${questionKey}`]: {
            answer,
            questionKey,
            defaultQuestion: true
          }
        }
      })
      console.log('changed security question')
    }
    return res.json(successResponse({
      message: i18n.__('MESSAGE:SUCCESSFUL_CHANGE_USER_DATA', { user: user.name })
    }))
  } catch (error) {
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/updateSecurityData', handleUpdateSecurityData)

export const handleSaveSecureDevice = async (req, res) => {
  const uid = req.body.uid
  const deviceUniqueToken = req.body.token
  let snapshot: database.DataSnapshot
  let user: IUserData
  try {
    snapshot = await getUserByUID(uid)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:UID_NOT_FOUND')
      }))
    }
    user = snapshot.val()
    if (user.secureDevices.includes(deviceUniqueToken)) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:DUPLICATED_DEVICE')
      }))
    }
    user.secureDevices.push(deviceUniqueToken)
    await updateUserData(uid, { secureDevices: user.secureDevices })
    return res.json(successResponse({
      message: i18n.__('MESSAGE:SECURE_DEVICE_ADDED')
    }))
  } catch (error) {
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/saveSecureDevice', handleSaveSecureDevice)

export const handleTestTransaction = async (req, res) => {
  let receiverUid = req.body.receiverUid
  let senderUid = req.body.senderUid
  // let date = req.body.date
  let dateFormat = req.body.dateFormat
  let description = req.body.description
  let currency = req.body.currency
  let amount = req.body.amount
  let receiverEmail = req.body.receiverEmail
  let receiverProfilePicture = req.body.receiverProfilePicture
  let receiverUsername = req.body.receiverUsername
  let senderEmail = req.body.senderEmail
  let senderProfilePicture = req.body.senderProfilePicture
  let senderUsername = req.body.senderUsername
  // let time = req.body.time
  let date = momentTz.tz('America/Caracas').format('YYYY-MM-DD')
  let time = momentTz.tz('America/Caracas').format('HH:mm:ss')
  try {
    let transactionData = {
      amount, //: 300,
      currency, //: 'Bs.S',
      date, //: "2018-03-01",
      dateFormat, //: "March 01",
      description,//: "pago",
      idTransaction: "",
      receiverEmail, //: "josedbarrios7@gmail.com",
      receiverProfilePicture, //: "https://scontent-mia3-1.xx.fbcdn.net/v/t1.0-9/1...",
      receiverUid, //: "0Y8g4xLcGCbGv7T7pBmOCDL4WLZ2",
      receiverUsername, //: "Jose Barrios",
      senderEmail, //: "meykelzambranofl@gmail.com",
      senderProfilePicture,//: "https://scontent-mia3-1.xx.fbcdn.net/v/t1.0-1/1...",
      senderUid,//: "89aoaspGQqauHsCwa6aQglEcmyG2",
      senderUsername, //: "Meykel Zambrano",
      time, //: "06:46:05 pm",
      transactionLinked: "",
      transactionType: "receive",
    }
    let linkedTransactionData = {
      amount,
      currency,
      date,
      dateFormat,
      description,
      idTransaction: "",
      receiverEmail,
      receiverProfilePicture,
      receiverUid, //: "0Y8g4xLcGCbGv7T7pBmOCDL4WLZ2",
      receiverUsername,
      senderEmail,
      senderProfilePicture,
      senderUid,//: "89aoaspGQqauHsCwa6aQglEcmyG2",
      senderUsername,
      time,
      transactionLinked: "",
      transactionType: "send",
    }
    //await saveTestTransactionData(transactionData, linkedTransactionData)

    const firstKey = transactionLog.push().key
    const secondKey = transactionLog.push().key
    transactionData.idTransaction = firstKey
    transactionData.transactionLinked = secondKey
    linkedTransactionData.idTransaction = secondKey
    linkedTransactionData.transactionLinked = firstKey

    await userHistory.child(receiverUid).child(firstKey).set(transactionData)
    await userHistory.child(senderUid).child(secondKey).set(linkedTransactionData)
    return res.send('now yes')
  } catch (error) {
    return res.send(`error ${error}`)
  }
}
app.post('/testTransaction', handleTestTransaction)

export const handleUpdateProfileImage = async (req, res) => {
  const uid = req.body.uid
  const image = req.body.image

  const mimeType = image.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/)[1]
  const fileName = `${Date.now()}.${mimeTypes.detectExtension(mimeType)}`
  const base64EncodedImageString = image.split(/,(.+)/)[1]
  const imageBuffer = new Buffer(base64EncodedImageString, 'base64')

  try {
    // Instantiate the GCP Storage instance 
    const bucket = gcs.bucket('gualy-b39cb.appspot.com')

    // Upload the image to the bucket 
    const file = bucket.file(`profiles/${uid}/${fileName}`)
    await file.save(imageBuffer, {
      metadata: {
        contentType: mimeType
      },
      public: true,
      validation: 'md5'
    })
    const config = {
      action: 'read',
      expires: '03-09-2020'
    }

    const promesa = await file.getSignedUrl(config)
    const profilePicture = promesa[0]
    console.log(profilePicture)
    await users.child(uid).update({ profilePicture })
    console.log('Updated')
    return res.json(successResponse({
      message: i18n.__('MESSAGE:SUCCESSFUL_CHANGE_USER_PROFILE_IMAGE'),
      profilePicture
    }))
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }));
  }
}
app.post('/updateProfileImage', handleUpdateProfileImage)

export const handleAddBankAccount = async (req, res) => {
  let uid = req.body.uid
  let bankAccountNumber = req.body.bankAccountNumber
  let bankPicture = req.body.bankPicture
  let snapshot: database.DataSnapshot
  let user: IUserData
  let bankAccountNumberArray: any = []
  try {
    snapshot = await getUserByUID(uid)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:UID_NOT_FOUND')
      }))
    }
    user = snapshot.val()
    let bankAccountData: IBankAccountData
    if (user.type === 'commerce') {
      snapshot = await getCommerceByUID(uid)
      let commerce: ICommerceData = snapshot.val()
      bankAccountData = {
        bankAccountNumber,
        name: commerce.name,
        dni: {
          id: commerce.commerceRegisterId.id,
          type: commerce.commerceRegisterId.type
        },
        email: commerce.email,
        phone: commerce.phone,
        uid,
        bankPicture: bankPicture || ''
      }
    } else {
      bankAccountData = {
        bankAccountNumber,
        name: user.name,
        dni: {
          id: user.dni.id,
          type: user.dni.type
        },
        email: user.email,
        phone: user.phone,
        uid,
        bankPicture: bankPicture || ''
      }
    }
    if (!user.bankAccount) {
      console.log('first bank account')
      await addBankAccountToUser(uid, bankAccountData)
    } else {
      console.log('adding another bank account bank account')
      let bankAccountObject = user.bankAccount
      console.log(user.bankAccount)
      for (const key in bankAccountObject) {
        if (bankAccountObject.hasOwnProperty(key)) {
          const element = bankAccountObject[key].bankAccountNumber;
          bankAccountNumberArray.push(element)
        }
      }
      if (bankAccountNumberArray.includes(bankAccountNumber)) {
        return res.json(errorResponse({
          message: i18n.__('VALIDATION:BANK_ACCOUNT_ALREADY_EXISTS')
        }))
      }
      await addBankAccountToUser(uid, bankAccountData)
    }
    return res.json(successResponse({
      message: i18n.__('MESSAGE:BANK_ACCOUNT_ADDED')
    }))
  } catch (error) {
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/addBankAccount', handleAddBankAccount)

export const handleRemoveBankAccount = async (req, res) => {
  let bankAccountNumber = req.body.bankAccountNumber
  let uid = req.body.uid
  console.log('host and body')
  console.log(req.host)
  console.log(req.hostname)
  console.log(req.body)
  console.log(bankAccountNumber, uid)
  let snapshot: database.DataSnapshot
  try {
    snapshot = await getUserByUID(uid)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:UID_NOT_FOUND')
      }))
    }
    let { bankAccount }: IUserData = snapshot.val()
    console.log('bankAccount')
    console.log(bankAccount)
    let bankAccountID
    for (const key in bankAccount) {
      if (bankAccount.hasOwnProperty(key)) {
        const element: IBankAccountData = bankAccount[key]
        if (element.bankAccountNumber === bankAccountNumber) {
          bankAccountID = element.bankAccountID
        }
      }
    }
    if (bankAccountID) {
      await removeBankAccountNumber(uid, bankAccountID)
      return res.json(successResponse({
        message: i18n.__('MESSAGE:BANK_ACCOUNT_DELETED')
      }))
    } else {
      return res.json(successResponse({
        message: i18n.__('ERROR:BANK_ACCOUNT_NOT_FOUND')
      }))
    }
  } catch (error) {
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/removeBankAccount', handleRemoveBankAccount)

export const handleSendMoney = async (req, res) => {
  let receiverEmail = req.body.receiverEmail
  let senderUid = req.body.senderUid
  // let date = req.body.date
  let description = req.body.description
  let currency = req.body.currency
  let amount = req.body.amount
  // let time = req.body.time
  let date = momentTz.tz('America/Caracas').format('YYYY-MM-DD')
  let time = momentTz.tz('America/Caracas').format('HH:mm:ss')
  let language = req.body.lang || lang
  moment.locale(language)
  console.log('body')
  console.log(req.body)
  let snapshot: database.DataSnapshot
  let senderData: IUserData
  let receiverData: IUserData
  try {
    console.log('getting snapshots')
    snapshot = await getUserByUID(senderUid)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:UID_NOT_FOUND')
      }))
    }
    senderData = snapshot.val()
    console.log(`senderData ${senderData}`)
    snapshot = await getUserDataByAttrib('email', receiverEmail)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:UID_NOT_FOUND')
      }))
    }
    let fecthedData = snapshot.val()
    for (const userData in fecthedData) {
      if (fecthedData.hasOwnProperty(userData)) {
        receiverData = fecthedData[userData];
      }
    }
    console.log(`receiverData`)
    console.log(receiverData)
    if (senderData.userKey === receiverData.userKey) {
      return res.json(errorResponse({
        message: i18n.__('VALIDATION:YOU_CANNOT_TRANSFER_TO_YOURSELF')
      }))
    }

    let firstKey = receiverData.type === 'client' ? 'U' : 'C'
    let secondKey = senderData.type === 'client' ? 'U' : 'C'

    let dateFormat = capitalizeFirstLetter(moment(date).format('MMM DD'))
    let transactionData: ITransactionHistory = {
      amount, //: 300,
      // fee: ,
      currency, //: 'Bs.S',
      date, //: "2018-03-01",
      dateFormat,
      dateTime: `${date} ${time}`,
      description,//: "pago",
      idTransaction: '',
      receiverEmail, //: "josedbarrios7@gmail.com",
      receiverProfilePicture: receiverData.thumbnail || receiverData.profilePicture || '', //: "https://scontent-mia3-1.xx.fbcdn.net/v/t1.0-9/1...",
      receiverUid: receiverData.userKey, //: "0Y8g4xLcGCbGv7T7pBmOCDL4WLZ2",
      receiverUsername: receiverData.name, //: "Jose Barrios",
      senderEmail: senderData.email, //: "meykelzambranofl@gmail.com",
      senderProfilePicture: senderData.thumbnail || senderData.profilePicture || '',//: "https://scontent-mia3-1.xx.fbcdn.net/v/t1.0-1/1...",
      senderUid,//: "89aoaspGQqauHsCwa6aQglEcmyG2",
      senderUsername: senderData.name, //: "Meykel Zambrano",
      time, //: "06:46:05 pm",
      transactionLinked: '',
      transactionType: '',
      status: 'Pending',
      source: 'toUser',
      mode: '',
      transactionRelationship: `${firstKey}2${secondKey}`,
      read: false,
      timestamp: database.ServerValue.TIMESTAMP
    }
    // aqui
    let moneyRequestStatus = await proccessSendMoney(transactionData)
    if (!moneyRequestStatus.success) {
      return res.json(errorResponse({
        message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: moneyRequestStatus.error })
      }))
    }
    console.log("About to create Notification")
    await createUserNotification(receiverData.userKey, {
      amount: transactionData.amount,
      currency: transactionData.currency,
      description: transactionData.description,
      mode: 'Receive',
      receiverUid: transactionData.receiverUid,
      receiverEmail: transactionData.receiverEmail,
      receiverProfilePicture: transactionData.receiverProfilePicture,
      receiverUsername: transactionData.receiverUsername,
      senderUid: transactionData.senderUid,
      senderEmail: transactionData.senderEmail,
      senderProfilePicture: transactionData.senderProfilePicture,
      senderUsername: transactionData.senderUsername,
      status: transactionData.status,
      userKey: receiverData.userKey,
      timestamp: Date.now(),
      type: 'transaction_notification'
    })
    return res.json(successResponse({
      message: i18n.__('LABEL:SENT_PAYMENT')
    }))
  } catch (error) {
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/sendMoney', handleSendMoney)

export const handleMakeMoneyRequest = async (req, res) => {
  let senderEmail = req.body.senderEmail
  let receiverUid = req.body.receiverUid
  let description = req.body.description
  let currency = req.body.currency
  let amount = req.body.amount
  let date = momentTz.tz('America/Caracas').format('YYYY-MM-DD')
  let time = momentTz.tz('America/Caracas').format('HH:mm:ss')
  let language = req.body.lang || lang
  moment.locale(language)
  console.log('body')
  console.log(req.body)
  let snapshot: database.DataSnapshot
  let senderData: IUserData
  let receiverData: IUserData
  try {
    console.log('getting snapshots')
    snapshot = await getUserByUID(receiverUid)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:UID_NOT_FOUND')
      }))
    }
    receiverData = snapshot.val()
    console.log(`receiverData ${receiverData}`)
    snapshot = await getUserDataByAttrib('email', senderEmail)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:UID_NOT_FOUND')
      }))
    }
    let fecthedData = snapshot.val()
    for (const userData in fecthedData) {
      if (fecthedData.hasOwnProperty(userData)) {
        senderData = fecthedData[userData];
      }
    }
    console.log(`senderData`)
    console.log(senderData)
    if (senderData.userKey === receiverData.userKey) {
      return res.json(errorResponse({
        message: i18n.__('VALIDATION:YOU_CANNOT_TRANSFER_TO_YOURSELF')
      }))
    }

    let firstKey = senderData.type === 'client' ? 'U' : 'C'
    let secondKey = receiverData.type === 'client' ? 'U' : 'C'

    let dateFormat = capitalizeFirstLetter(moment(date).format('MMM DD'))
    let transactionData: ITransactionHistory = {
      amount, //: 300,
      currency, //: 'Bs.S',
      date, //: "2018-03-01",
      dateFormat,
      dateTime: `${date} ${time}`,
      description,//: "pago",
      idTransaction: '',
      receiverEmail: receiverData.email, //: "josedbarrios7@gmail.com",
      receiverProfilePicture: receiverData.thumbnail || receiverData.profilePicture || '', //: "https://scontent-mia3-1.xx.fbcdn.net/v/t1.0-9/1...",
      receiverUid, //: "0Y8g4xLcGCbGv7T7pBmOCDL4WLZ2",
      receiverUsername: receiverData.name, //: "Jose Barrios",
      senderEmail, //: "meykelzambranofl@gmail.com",
      senderProfilePicture: senderData.thumbnail || senderData.profilePicture || '',//: "https://scontent-mia3-1.xx.fbcdn.net/v/t1.0-1/1...",
      senderUid: senderData.userKey,//: "89aoaspGQqauHsCwa6aQglEcmyG2",
      senderUsername: senderData.name, //: "Meykel Zambrano",
      time, //: "06:46:05 pm",
      transactionLinked: '',
      transactionType: '',
      status: 'Pending',
      mode: '',
      transactionRelationship: `${firstKey}2${secondKey}`,
      read: false,
      timestamp: database.ServerValue.TIMESTAMP
    }

    let moneyRequestStatus = await saveMoneyRequest(transactionData)
    if (!moneyRequestStatus.success) {
      return res.json(errorResponse({
        message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: moneyRequestStatus.error })
      }))
    }
    if (senderData.FCMToken) {
      await pushNotificationSender(
        [transactionData.senderUid],
        'Gualy',
        i18n.__('LABEL:RECEIVED_MONEY_REQUEST', {
          name: receiverData.name,
          currency: transactionData.currency,
          amount,
        }),
        {
          transactionID: moneyRequestStatus.senderTransactionID,
          pic: transactionData.receiverProfilePicture,
          name: receiverData.name,
          amount: transactionData.amount,
          currency: transactionData.currency,
          description: transactionData.description,
          message: i18n.__('LABEL:RECEIVED_MONEY_REQUEST', {
            name: receiverData.name,
            currency: transactionData.currency,
            amount
          })
        },
        'request_payment'
      )
    }
    let templatePath = `${__dirname}/emailTemplates/receivedMoneyRequest.html`
    let fileBuffer = fs.readFileSync(templatePath)
    let sg = new SendGridService()
    let subject = i18n.__('LABEL:RECEIVED_MONEY_REQUEST', {
      name: receiverData.name,
      currency: transactionData.currency,
      amount,
    })
    // resolver aqui
    await sg.send('Gualy',
      infoEmail,
      [transactionData.senderEmail],
      subject,
      fileBuffer.toString(),
      {
        '%acceptMoneyRequestDeepLink%': acceptMoneyRequestDeepLink,
        '%amount%': moneyRequestStatus.senderData.amount.toString(),
        '%ayuda%': ayuda,
        '%condiciones%': condiciones,
        '%currency%': moneyRequestStatus.senderData.currency,
        '%deepLink%': deepLink,
        '%description%': transactionData.description,
        '%facebook%': facebook,
        '%faq%': faq,
        '%instagram%': instagram,
        '%previewText%': previewText,
        '%receiverusername%': moneyRequestStatus.senderData.receiverUsername,
        '%rejectMoneyRequestDeepLink%': rejectMoneyRequestDeepLink,
        '%senderusername%': moneyRequestStatus.senderData.senderUsername,
        '%subject%': subject,
        '%supportEmail%': supportEmail,
        '%twitter%': twitter
      })
    return res.json(successResponse({
      message: i18n.__('LABEL:SENT_MONEY_REQUEST')
    }))
  } catch (error) {
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/makeMoneyRequest', handleMakeMoneyRequest)

export const handleGetBasicDataByUid = async (req, res) => {
  let uids: string = req.body.uids || false
  let adminID: string = req.body.adminUid
  let adminSnapshot: database.DataSnapshot
  // let adminData: IUserData
  console.log('params', uids, adminID)
  if (!uids) {
    return res.json(errorResponse({
      message: i18n.__('ERROR:MISSING_PARAMETERS')
    }))
  }
  let uidsArray: string[] = uids.split(',')
  console.log('after split users ids', uidsArray)
  let usersInfo: IUserData[] = []
  try {
    console.log('checking admin id')
    adminSnapshot = await getUserByUID(adminID)
    if (!adminSnapshot) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:ADMIN_UID_NOT_FOUND')
      }))
    }
    console.log('create user promises')
    const usersPromise: Array<Promise<database.DataSnapshot>> = []
    while (uidsArray.length) {
      const uid = uidsArray.splice(0, 1)[0]
      usersPromise.push(users.child(uid).once('value'))
    }
    // adminData = adminSnapshot.val()
    // if (adminData.type !== 'admin') {
    //   return res.json(errorResponse({
    //     message: i18n.__('ERROR:ADMIN_UID_NOT_FOUND')
    //   }))
    // }
    const usersData: database.DataSnapshot[] = await Promise.all(usersPromise)
    console.log('reached data')
    usersData.forEach((snapshot) => {
      const user: IUserData = snapshot.val()
      usersInfo.push({
        userKey: user.userKey,
        name: user.name,
        email: user.email,
        phone: user.phone,
        profilePicture: user.thumbnail || user.profilePicture || '',
        type: user.type
      })
    })
    console.log('last log')
    return res.json(successResponse({
      usersInfo
    }))
  } catch (error) {
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/getBasicDataByUid', handleGetBasicDataByUid)

export const handleAddMoneyToGualy = async (req, res) => {
  let ipAddress = req.body.ipAddress || req.ip
  let gualyToken = req.body.token
  let uid = req.body.uid
  let amount = req.body.amount
  let currency = req.body.currency
  let date = momentTz.tz('America/Caracas').format('YYYY-MM-DD')
  let time = momentTz.tz('America/Caracas').format('HH:mm:ss')
  let language = req.body.lang || lang
  moment.locale(language)
  let user: IUserData
  let snapshot: database.DataSnapshot
  try {
    snapshot = await getUserByUID(uid)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:UID_NOT_FOUND')
      }))
    }
    user = snapshot.val()
    let requestResult = await makeGualyPayment({
      amountToPay: amount,
      description: 'Compra de creditos',
      gID: user.gID,
      ipAddress,
      privateKey: gualyPaymentGateway.private,
      token: gualyToken
    })
    if (!requestResult.success) {
      return res.json(errorResponse({
        message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: requestResult.error })
      }))
    }
    if (!requestResult.data.success) {
      return res.json(errorResponse({
        message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: requestResult.data.error })
      }))
    }
    console.log('requestResult')
    console.log(requestResult)
    console.log('requestResult data')
    console.log(requestResult.data)
    console.log('requestResult data data')
    console.log(requestResult.data.data)
    let gualyPaymentResponse: IGualyPaymentResponse = requestResult.data.data.data
    console.log('gualyPaymentResponse')
    console.log(gualyPaymentResponse)
    let dateFormat = capitalizeFirstLetter(moment(date).format('MMM DD'))
    let data: ITransactionHistory = {
      amount,
      bankReference: gualyPaymentResponse.reference,
      currency,
      date,
      dateFormat,
      dateTime: `${date} ${time}`,
      description: 'Compra de creditos',
      read: false,
      gualyPaymentGatewayDate: gualyPaymentResponse.transactionDay,
      gualyPaymentGatewayTime: gualyPaymentResponse.transactionHour,
      gualyPaymentGatewayTransactionID: gualyPaymentResponse.transactionKey,
      idTransaction: '',
      receiverEmail: user.email,
      receiverProfilePicture: user.thumbnail || user.profilePicture || '',
      receiverUid: user.userKey,
      receiverUsername: user.name,
      status: 'Approved',
      time,
      transactionType: 'Receive',
      mode: 'Purchase',
      transactionRelationship: 'U2G',
      timestamp: database.ServerValue.TIMESTAMP
    }
    let { success, transactionData, error } = await saveTransaction(user.userKey, data)

    if (!success) {
      return res.json(errorResponse({
        message: i18n.__('INTERNAL_SERVER_ERROR', { error })
      }))
    }
    let newAmount = addAmount(user.amount.toString(), amount)
    await Promise.all([
      updateUserData(user.userKey, { amount: newAmount, notificationFlag: true }),
      pushNotificationSender([user.userKey], 'Gualy', i18n.__('MESSAGE:SUCCESSFUL_PURCHASE'), {}, 'notification')
    ])

    return res.json(successResponse({
      message: i18n.__('MESSAGE:SUCCESSFUL_PURCHASE'),
      transactionData
    }))
  } catch (error) {
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/addMoneyToGualy', handleAddMoneyToGualy)

export const handleWithDrawMoneyFromGualy = async (req, res) => {
  console.log('withDrawMoneyFromGualy Body')
  console.log(req.body)
  let amount = req.body.amount ? parseFloat(req.body.amount) : false
  let currency = req.body.currency
  // let date = req.body.date
  // let time = req.body.time
  let date = momentTz.tz('America/Caracas').format('YYYY-MM-DD')
  let time = momentTz.tz('America/Caracas').format('HH:mm:ss')
  let uid = req.body.uid
  let userBankAccount = req.body.userBankAccount
  let language = req.body.lang || lang
  moment.locale(language)
  let snapshot: database.DataSnapshot
  let user: IUserData
  let bankAccounts
  if (!amount) {
    return res.json(errorResponse({
      message: i18n.__('INVALID_PARAMETERS')
    }))
  }
  try {
    snapshot = await getUserByUID(uid)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:UID_NOT_FOUND')
      }))
    }
    user = snapshot.val()
    if (user.amount < amount) {
      console.log('Monto insuficiente')
      return res.json(errorResponse({
        message: i18n.__('ERROR:INSUFFICIENT_FUNDS')
      }))
    }
    bankAccounts = user.bankAccount
    if (!bankAccounts[`${userBankAccount}`]) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:BANK_ACCOUNT_NOT_FOUND')
      }))
    }

    let newAmount = Number(user.amount) - amount
    let pendingWithDraw = 0
    if (user.pendingWithDraw) {
      pendingWithDraw = addAmount(user.pendingWithDraw.toString(), amount.toString())
    } else {
      pendingWithDraw = amount
    }
    let dateFormat = capitalizeFirstLetter(moment(date).format('MMM DD'))
    let transactionData: ITransactionHistory = {
      amount,
      description: i18n.__('MESSAGE:WITHDRAW'),
      currency,
      date,
      dateFormat,
      time,
      dateTime: `${date} ${time}`,
      status: 'Pending',
      idTransaction: '',
      userBankAccount: bankAccounts[`${userBankAccount}`].bankAccountNumber,
      senderUid: user.userKey,
      senderEmail: user.email,
      senderProfilePicture: user.thumbnail || user.profilePicture || '',
      senderUsername: user.name,
      bankReference: '',
      transactionType: 'Send',
      gualyBankAccount: '',
      read: false,
      mode: 'Withdraw',
      transactionRelationship: 'G2U',
      timestamp: database.ServerValue.TIMESTAMP
    }
    let promiseResult = await createWithdraw(user.userKey, transactionData)
    if (!promiseResult.success) {
      return res.json(errorResponse({
        message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: promiseResult.error })
      }))
    }
    await updateUserData(user.userKey, { amount: newAmount, pendingWithDraw })
    let templatePath = `${__dirname}/emailTemplates/receivedWithdrawRequest.html`
    let fileBuffer = fs.readFileSync(templatePath)
    let sg = new SendGridService()
    let subject = i18n.__('LABEL:PENDING_WITHDRAW_REQUEST')
    await sg.send('Gualy',
      infoEmail,
      [user.email],
      subject,
      fileBuffer.toString(),
      {
        '%username%': user.name,
        '%subject%': subject,
        '%bankAccount%': bankAccounts[`${userBankAccount}`].bankAccountNumber,
        '%deepLink%': deepLink,
        '%ayuda%': ayuda,
        '%faq%': faq,
        '%condiciones%': condiciones,
        '%facebook%': facebook,
        '%twitter%': twitter,
        '%instagram%': instagram,
        '%previewText%': previewText,
        '%supportEmail%': supportEmail
      })

    return res.json(successResponse({
      message: i18n.__('LABEL:PENDING_WITHDRAW_REQUEST')
    }))
  } catch (error) {
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/withDrawMoneyFromGualy', handleWithDrawMoneyFromGualy)

export const handleProcessWithdraw = async (req, res) => {
  let adminID = req.body.adminID
  let bankReference = req.body.bankReference
  let transactionID = req.body.transactionID
  let reason = req.body.reason || ''
  let action = req.body.action === 'Approved' || req.body.action === 'Rejected' ? req.body.action : false
  if (!action || !adminID || !transactionID || !bankReference) {
    return res.json(errorResponse({
      message: i18n.__('INVALID_PARAMETERS')
    }))
  }
  let snapshot: database.DataSnapshot
  let transactionData: ITransactionHistory
  let user: IUserData
  let admin: IUserData
  try {
    console.log("getting AdminData")
    snapshot = await getUserByUID(adminID)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:ADMIN_UID_NOT_FOUND')
      }))
    }
    admin = snapshot.val()
    console.log("getting TransactionData")
    snapshot = await getTransacionData(transactionID)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:TRANSACTION_NOT_FOUND')
      }))
    }
    transactionData = snapshot.val()
    transactionData.operator = {
      email: admin.email,
      name: admin.name,
      profilePicture: admin.thumbnail || admin.profilePicture || '',
      uid: admin.userKey
    }
    transactionData.bankReference = bankReference || ''
    transactionData.status = action
    transactionData.read = false
    transactionData.reason = reason
    console.log("senderUid >", transactionData.senderUid)
    snapshot = await getUserByUID(transactionData.senderUid)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:UID_NOT_FOUND')
      }))
    }
    user = snapshot.val()
    console.log("Going to processPendingWithdraw")
    let withDrawResults = await processPendingWithdraw(user, transactionData)
    if (!withDrawResults.success) {
      return res.json(errorResponse({
        message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: withDrawResults.error })
      }))
    }
    let amount: any = transactionData.amount
    await pushNotificationSender(
      [user.userKey],
      'Gualy',
      action === 'Approved' ? i18n.__('MESSAGE:SUCCESSFUL_WITHDRAW',
        {
          currency: transactionData.currency,
          amount
        }) : i18n.__('MESSAGE:REJECTED_WITHDRAW', {
          currency: transactionData.currency,
          amount
        }),
      { transactionID: transactionData.idTransaction },
      'transaction_notification'
    )
    let templatePath = `${__dirname}/emailTemplates/processedWithdrawRequest.html`
    let fileBuffer = fs.readFileSync(templatePath)
    let sg = new SendGridService()
    let subject = action === 'Approved' ? i18n.__(
      'MESSAGE:SUCCESSFUL_WITHDRAW',
      {
        currency: transactionData.currency,
        amount
      }
    ) : i18n.__(
      'MESSAGE:REJECTED_WITHDRAW',
      {
        currency: transactionData.currency,
        amount
      }
    )
    console.log("Sending email, transactionData ->", transactionData)
    await sg.send('Gualy',
      infoEmail,
      [user.email],
      subject,
      fileBuffer.toString(),
      {
        '%amount%': action === 'Approved' ? transactionData.amount.toString() : '0',
        '%net%': action === 'Approved' ? transactionData.amount.toString() : '0',
        '%fee%': '0',
        '%subject%': subject,
        '%username%': user.name,
        '%bankAccount%': transactionData.userBankAccount,
        '%currency%': transactionData.currency,
        '%transactionId%': transactionData.idTransaction,
        '%date%': transactionData.dateTime,
        '%deepLink%': deepLink,
        '%ayuda%': ayuda,
        '%faq%': faq,
        '%condiciones%': condiciones,
        '%facebook%': facebook,
        '%twitter%': twitter,
        '%instagram%': instagram,
        '%previewText%': previewText,
        '%supportEmail%': supportEmail
      }
    )
    return res.json(successResponse({
      message: i18n.__('MESSAGE:SUCCESSFUL_TRANSFERENCE')
    }))
  } catch (error) {
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/processWithdraw', handleProcessWithdraw)

export const handleGetNearbyCommerces = async (req, res) => {
  let lat = req.body.latitude
  let lon = req.body.longitude
  let requestedDistance = req.body.distance || null
  let uid = req.body.uid
  // let user: IUserData
  let snapshot: database.DataSnapshot
  try {
    snapshot = await getUserByUID(uid)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:UID_NOT_FOUND')
      }))
    }
    let commercesPromise = await nearbyCommerces({ lon, lat }, requestedDistance)

    if (!commercesPromise.success) {
      return res.json(errorResponse({
        message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: commercesPromise.error })
      }))
    }
    return res.json(successResponse({
      commerces: commercesPromise.nearbyCommerces
    }))
  } catch (error) {
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/getNearbyCommerces', handleGetNearbyCommerces)


// ISSUES
export const handleMakeIssue = async (req, res) => {
  let uid = req.body.uid
  let category = req.body.category
  let message = req.body.message
  let description = req.body.description
  // let date = req.body.date
  // let time = req.body.time
  let date = momentTz.tz('America/Caracas').format('YYYY-MM-DD')
  let time = momentTz.tz('America/Caracas').format('HH:mm:ss')
  let attachments: IAttachments[] = req.body.attachments
  console.log(req.body)
  console.log('attachments')
  console.log(attachments)
  if (!uid || !category || !message || !date || !time) {
    return res.json(errorResponse({
      message: i18n.__('INVALID_PARAMETERS')
    }))
  }
  let dateTime = `${date} ${time}`
  let snapshot: database.DataSnapshot
  let user: IUserData
  try {
    snapshot = await getUserByUID(uid)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:UID_NOT_FOUND')
      }))
    }
    user = snapshot.val()
    let issueData: IIssueData = {
      issueUid: '',
      assigned: '',
      category,
      messages: [{
        message,
        date,
        time,
        dateTime,
        type: 'userMessage',
        userData: {
          userKey: user.userKey,
          name: user.name,
          email: user.email,
          phone: user.phone,
          profilePicture: user.thumbnail || user.profilePicture || ''
        }
      }],
      createdDate: date,
      createdTime: time,
      createdDateTime: dateTime,
      description: description,
      status: 'Pending',
      userData: {
        userKey: user.userKey,
        name: user.name,
        email: user.email,
        phone: user.phone,
        profilePicture: user.thumbnail || user.profilePicture || ''
      },
      attachments: '',
    }
    let issueResult = await makeNewIssue(issueData)

    if (!issueResult.success) {
      return res.json(errorResponse({
        message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: issueResult.error })
      }))
    }
    console.log('Check')
    console.log(Array.isArray(attachments))
    if (Array.isArray(attachments)) {
      console.log(`Attachments`)
      console.log(attachments[0])
      console.log(attachments[0].name || `image_${0}`)
      let base64Img = attachments[0].base64Img
      let name = attachments[0].name || `image_${0}`
      let path = `issuesAttachments/${issueResult.issueUid}`
      console.log(`path ${path}`)
      let attachmentsToSave: IAttachmentData = {
        name,
        url: '',
        user: issueData.userData,
        date: issueData.createdDate,
        time: issueData.createdTime,
        dateTime: issueData.createdDateTime,
        comment: attachments[0].comment || ''
      }
      await uploadIssueImage(base64Img,
        name,
        issueResult.issueUid,
        path,
        attachmentsToSave
      )
    }

    return res.json(successResponse({
      message: i18n.__('MESSAGE:SUCCESSFUL_CREATE_ISSUE', { issue: issueResult.issueUid })
    }))
  } catch (error) {
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/makeIssue', handleMakeIssue)

app.post('/assignAgent', handleAssingAgent)

app.post('/removeAgent', handleRemoveAgent)

app.post('/updateIssueStatus', handleUpdateIssueStatus)

app.post('/publicateIssueAnswer', handlePublicateIssueAnswer)

export const handleSetGualyHistory = async (req, res) => {
  let uid = req.body.uid
  // let date = req.body.date ? moment(req.body.date).format('YYYY-MM-DD') : false
  let snapshot: database.DataSnapshot
  let admin: IUserData
  if (!uid) {
    return res.json(errorResponse({
      message: i18n.__('INVALID_PARAMETERS')
    }))
  }
  try {
    snapshot = await getUserByUID(uid)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:ADMIN_UID_NOT_FOUND')
      }))
    }
    admin = snapshot.val()
    if (admin.type !== 'admin') {
      return res.json(errorResponse({
        message: i18n.__('VALIDATION:UNAUTHORIZED_USER')
      }))
    }
    let date = momentTz.tz('America/Caracas').format('YYYY-MM-DD')
    let time = momentTz.tz('America/Caracas').format('HH:mm:ss')
    let historySnapshot = await checkGualyHistory(date)
    if (historySnapshot.exists()) {
      let updateResponse = await updateGualyHistory(date, time)
      if (!updateResponse.success) {
        return res.json(errorResponse({
          message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: updateResponse.error })
        }))
      }
      return res.json(successResponse(updateResponse.data))
    }
    let { success, error, data } = await saveNewGualyHistory(date, time)
    if (!success) {
      return res.json(errorResponse({
        message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error })
      }))
    }
    return res.json(successResponse(data))
  } catch (error) {
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/setGualyHistory', handleSetGualyHistory)

export const handleCloseSession = async (req, res) => {
  let uid = req.body.uid
  let adminID = req.body.adminID
  let admin: IUserData
  let user: IUserData
  let snapshot: database.DataSnapshot
  let reason = req.body.reason
  let action = req.body.action === 'block' || req.body.action === 'ban' ? req.body.action : false
  try {
    snapshot = await getUserByUID(uid)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:ADMIN_UID_NOT_FOUND')
      }))
    }
    user = snapshot.val()
    if (user.blocked) {
      return res.json(errorResponse({
        message: 'Usuario ya se encuentra bloqueado'
      }))
    }
    snapshot = await getUserByUID(adminID)
    admin = snapshot.val()
    if (admin.type !== 'admin') {
      return res.json(errorResponse({
        message: i18n.__('VALIDATION:UNAUTHORIZED_USER')
      }))
    }
    if (action) {
      let date = momentTz.tz('America/Caracas').format('YYYY-MM-DD')
      let time = momentTz.tz('America/Caracas').format('HH:mm:ss')
      await updateUser(uid, { disabled: true })
      await updateUserData(
        uid,
        {
          blocked: true,
          blockedDate: date,
          blockedTime: time,
          blockedDateTime: `${date} ${time}`
        }
      )
    }
    let templatePath = `${__dirname}/emailTemplates/blockedUser.html`
    let fileBuffer = fs.readFileSync(templatePath)
    let sg = new SendGridService()
    await pushNotificationSender([uid],
      'Gualy',
      action ? i18n.__('MESSAGE:USER_HAVE_BEEN_BLOCKED') : i18n.__('MESSAGE:SESSION_EXPIRED'),
      {
        description: reason || ''
      },
      'close_session')
    await sg.send('Gualy',
      infoEmail,
      [user.email],
      i18n.__('LABEL:USER_HAVE_BEEN_BLOCKED'),
      fileBuffer.toString(),
      {
        '%username%': user.name,
        '%subject%': i18n.__('LABEL:USER_HAVE_BEEN_BLOCKED'),
        '%deepLink%': deepLink,
        '%ayuda%': ayuda,
        '%faq%': faq,
        '%condiciones%': condiciones,
        '%facebook%': facebook,
        '%twitter%': twitter,
        '%instagram%': instagram,
        '%previewText%': previewText,
        '%supportEmail%': supportEmail
      })
    return res.json(successResponse({
      message: i18n.__('MESSAGE:SUCCESSFUL_BLOCKED_USER')
    }))
  } catch (error) {
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/closeSession', handleCloseSession)

export const handleUnBlockUser = async (req, res) => {
  let uid = req.body.uid
  let adminID = req.body.adminID
  let admin: IUserData
  let user: IUserData
  let snapshot: database.DataSnapshot
  try {
    snapshot = await getUserByUID(uid)
    if (!snapshot.exists()) {
      return res.json(errorResponse({
        message: i18n.__('ERROR:ADMIN_UID_NOT_FOUND')
      }))
    }
    console.log("Usuario Existe.")
    user = snapshot.val()
    if (!user.blocked) {
      return res.json(errorResponse({
        message: 'Usuario no se encuentra bloqueado'
      }))
    }
    console.log("Usuario esta bloqueado.")
    snapshot = await getUserByUID(adminID)
    admin = snapshot.val()
    if (admin.type !== 'admin') {
      return res.json(errorResponse({
        message: i18n.__('VALIDATION:UNAUTHORIZED_USER')
      }))
    }
    console.log("Si es administrador.")
    await updateUser(uid, { disabled: false })
    console.log("updateUser() worked")
    await updateUserData(
      uid,
      {
        blocked: false,
        blockedDate: '',
        blockedTime: '',
        blockedDateTime: ``
      }
    )
    console.log("updateUserData() worked")
    await pushNotificationSender([uid],
      'Gualy',
      'Usuario ha sido desbloqueado.',
      {},
      'notification')
    console.log("passed pushNotificationSender")
    let templatePath = `${__dirname}/emailTemplates/unblockedUser.html`
    let fileBuffer = fs.readFileSync(templatePath)
    let sg = new SendGridService()
    await sg.send('Gualy',
      infoEmail,
      [user.email],
      i18n.__('LABEL:USER_HAVE_BEEN_UNBLOCKED'),
      fileBuffer.toString(),
      {
        '%username%': user.name,
        '%subject%': i18n.__('LABEL:USER_HAVE_BEEN_UNBLOCKED'),
        '%deepLink%': deepLink,
        '%ayuda%': ayuda,
        '%faq%': faq,
        '%condiciones%': condiciones,
        '%facebook%': facebook,
        '%twitter%': twitter,
        '%instagram%': instagram,
        '%previewText%': previewText,
        '%supportEmail%': supportEmail
      })
    console.log("Mail sent")
    return res.json(successResponse({
      message: i18n.__('MESSAGE:SUCCESSFUL_UNBLOCKED_USER')
    }))
  } catch (error) {
    return res.json(errorResponse({
      message: i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
    }))
  }
}
app.post('/unBlockUser', handleUnBlockUser)

export const handleGualyBalance = async (req, res) => {
  let date = req.body.date;
  let option = req.body.option;
  let result = [];
  switch (option) {
    case "today":
      result = await balanceFromToday(date);
      break;
    case "yesterday":
      result = await balanceFromYesterday(date);
      break;
    case "current_week":
      result = await balanceFromCurrentWeek(date);
      break;
    case "last_week":
      result = await balanceFromLastWeek(date);
      break;
    case "current_month":
      result = await balanceFromCurrentMonth(date);
      break;
    case "last_month":
      result = await balanceFromLastMonth(date);
      break;
    case "current_year":
      result = await balanceFromCurrentYear(date);
      break;
    case "last_year":
      result = await balanceFromLastYear(date);
      break;
    default:
      return res.json({
        message: 'The option is invalid',
        success: false,
      })
  }
  let finalAmount
  if (result[3] === 0) {
    finalAmount = result[2] + result[1];
  } else {
    finalAmount = result[3];
  }
  return res.json({
    data: {
      transactionCount: result[0],
      initialAmount: result[2],
      finalAmount: finalAmount,
      date: date
    },
    success: true,
  })
}
app.post('/gualyBalance', handleGualyBalance)

export const handleActivityUserCommerce = async (req, res, ) => {
  let today = req.body.date || false;
  if (!today) {
    return res.json({
      message: "date is undefined",
      success: false,
    })
  }
  let lastWeek = moment(today).utc().subtract(1, 'week').startOf('isoWeek').format('YYYY-MM-DD').toString();
  let endLastWeek = moment(today).utc().subtract(1, 'week').endOf('isoWeek').format('YYYY-MM-DD').toString();
  let currentWeek = moment(today).utc().startOf('isoWeek').format('YYYY-MM-DD').toString();
  let lastMonth = moment(today).utc().subtract(1, 'month').startOf('month').format('YYYY-MM-DD').toString();
  let endLastMonth = moment(today).utc().subtract(1, 'month').endOf('month').format('YYYY-MM-DD').toString();
  let yesterday = moment(today).utc().subtract(1, 'days').format('YYYY-MM-DD').toString();
  let lastYear = moment(today).utc().subtract(1, 'year').startOf('year').format('YYYY-MM-DD').toString();
  let endLastYear = moment(today).utc().subtract(1, 'year').endOf('year').format('YYYY-MM-DD').toString();
  let currentMonth = moment(today).utc().startOf('month').format('YYYY-MM-DD').toString();
  let currentYear = moment(today).utc().startOf('year').format('YYYY-MM-DD').toString();

  let result = [];
  await Promise.all([userVsCommerce(today, today),
  userVsCommerce(yesterday, today),
  userVsCommerce(lastWeek, endLastWeek),
  userVsCommerce(currentWeek, today),
  userVsCommerce(currentMonth, today),
  userVsCommerce(lastMonth, endLastMonth),
  userVsCommerce(currentYear, today),
  userVsCommerce(lastYear, endLastYear)
  ]).then(values => {
    result = values
  })
  return res.json({
    today: result[0],
    yesterday: result[1],
    lastWeek: result[2],
    currentWeek: result[3],
    currentMonth: result[4],
    lastMonth: result[5],
    currentYear: result[6],
    lastYear: result[7]
  })
}
app.post('/activityUserCommerce', handleActivityUserCommerce)

export const handleCommerceEvolution = async (req, res) => {
  let date = req.body.date || false;
  if (!date) {
    return res.json({
      message: "date is undefined",
      success: false,
    })
  }
  let result = []
  await Promise.all([daysAgoReport(0, date),
  daysAgoReport(1, date),
  daysAgoReport(2, date),
  daysAgoReport(3, date),
  daysAgoReport(4, date),
  daysAgoReport(5, date),
  daysAgoReport(6, date),
  daysAgoReport(7, date),
  daysAgoReport(8, date),
  daysAgoReport(9, date)
  ])
    .then(values => {
      result = values
    })
  return res.json({
    today: result[0],
    yesterday: result[1],
    twoDaysAgo: result[2],
    threeDaysAgo: result[3],
    fourDaysAgo: result[4],
    fiveDaysAgo: result[5],
    sixDaysAgo: result[6],
    sevenDaysAgo: result[7],
    eightDaysAgo: result[8],
    nineDaysAgo: result[9]
  })
}
app.post('/commerceEvolution', handleCommerceEvolution)

export const handleKpiDeposit = async (req, res) => {
  let today = req.body.date || false;
  if (!today) {
    return res.json({
      message: "date is undefined",
      success: false,
    })
  }
  let lastWeek = moment(today).utc().subtract(1, 'week').startOf('isoWeek').format('YYYY-MM-DD').toString();
  let endLastWeek = moment(today).utc().subtract(1, 'week').endOf('isoWeek').format('YYYY-MM-DD').toString();
  let currentWeek = moment(today).utc().startOf('isoWeek').format('YYYY-MM-DD').toString();
  let lastMonth = moment(today).utc().subtract(1, 'month').startOf('month').format('YYYY-MM-DD').toString();
  let endLastMonth = moment(today).utc().subtract(1, 'month').endOf('month').format('YYYY-MM-DD').toString();
  let yesterday = moment(today).utc().subtract(1, 'days').format('YYYY-MM-DD').toString();
  let currentMonth = moment(today).utc().startOf('month').format('YYYY-MM-DD').toString();
  let result = []
  await Promise.all([depositKpi(today, today),
  depositKpi(yesterday, today),
  depositKpi(currentWeek, today),
  depositKpi(lastWeek, endLastWeek),
  depositKpi(lastMonth, endLastMonth),
  depositKpi(currentMonth, today)
  ])
    .then(values => {
      result = values
    })
  return res.json({
    today: result[0],
    yesterday: result[1],
    currentWeek: result[2],
    lastWeek: result[3],
    lastMonth: result[4],
    currentMonth: result[5],
  })
}
app.post('/kpiDeposit', handleKpiDeposit)

export const handleKpiWithdraw = async (req, res) => {
  let today = req.body.date || false;
  if (!today) {
    return res.json({
      message: "date is undefined",
      success: false,
    })
  }
  let lastWeek = moment(today).utc().subtract(1, 'week').startOf('isoWeek').format('YYYY-MM-DD').toString();
  let endLastWeek = moment(today).utc().subtract(1, 'week').endOf('isoWeek').format('YYYY-MM-DD').toString();
  let currentWeek = moment(today).utc().startOf('isoWeek').format('YYYY-MM-DD').toString();
  let lastMonth = moment(today).utc().subtract(1, 'month').startOf('month').format('YYYY-MM-DD').toString();
  let endLastMonth = moment(today).utc().subtract(1, 'month').endOf('month').format('YYYY-MM-DD').toString();
  let yesterday = moment(today).utc().subtract(1, 'days').format('YYYY-MM-DD').toString();
  let currentMonth = moment(today).utc().startOf('month').format('YYYY-MM-DD').toString();
  let result = []
  await Promise.all([withdrawKpi(today, today),
  withdrawKpi(yesterday, today),
  withdrawKpi(currentWeek, today),
  withdrawKpi(lastWeek, endLastWeek),
  withdrawKpi(lastMonth, endLastMonth),
  withdrawKpi(currentMonth, today)
  ])
    .then(values => {
      result = values
    })
  return res.json({
    today: result[0],
    yesterday: result[1],
    currentWeek: result[2],
    lastWeek: result[3],
    lastMonth: result[4],
    currentMonth: result[5],
  })
}
app.post('/kpiWithdraw', handleKpiWithdraw)

export const handleKpiNumberTransaction = async (req, res) => {
  let today = req.body.date || false;
  if (!today) {
    return res.json({
      message: "date is undefined",
      success: false,
    })
  }
  let lastWeek = moment(today).utc().subtract(1, 'week').startOf('isoWeek').format('YYYY-MM-DD').toString();
  let endLastWeek = moment(today).utc().subtract(1, 'week').endOf('isoWeek').format('YYYY-MM-DD').toString();
  let currentWeek = moment(today).utc().startOf('isoWeek').format('YYYY-MM-DD').toString();
  let lastMonth = moment(today).utc().subtract(1, 'month').startOf('month').format('YYYY-MM-DD').toString();
  let endLastMonth = moment(today).utc().subtract(1, 'month').endOf('month').format('YYYY-MM-DD').toString();
  let yesterday = moment(today).utc().subtract(1, 'days').format('YYYY-MM-DD').toString();
  let currentMonth = moment(today).utc().startOf('month').format('YYYY-MM-DD').toString();
  let result = []
  await Promise.all([numberTransaction(today, today),
  numberTransaction(yesterday, today),
  numberTransaction(currentWeek, today),
  numberTransaction(lastWeek, endLastWeek),
  numberTransaction(lastMonth, endLastMonth),
  numberTransaction(currentMonth, today)
  ])
    .then(values => {
      result = values
      console.log(values);
    })
  return res.json({
    today: result[0],
    yesterday: result[1],
    currentWeek: result[2],
    lastWeek: result[3],
    lastMonth: result[4],
    currentMonth: result[5],
  })
}
app.post('/kpiNumberTransaction', handleKpiNumberTransaction)

export const handleKpiFee = async (req, res) => {
  let date = req.body.date || false;
  if (!date) {
    return res.json({
      message: "date is undefined",
      success: false,
    })
  }
  return res.json({
    today: {
      userToUserCount: 0,
      usersToCommerce: 0,
      total: 0 + 0
    },
    yesterday: {
      userToUserCount: 0,
      usersToCommerce: 0,
      total: 0 + 0
    },
    currentWeek: {
      userToUserCount: 0,
      usersToCommerce: 0,
      total: 0 + 0
    },
    lastWeek: {
      userToUserCount: 0,
      usersToCommerce: 0,
      total: 0 + 0
    },
    lastMonth: {
      userToUserCount: 0,
      usersToCommerce: 0,
      total: 0 + 0
    },
    currentMonth: {
      userToUserCount: 0,
      usersToCommerce: 0,
      total: 0 + 0
    }
  })
}
app.post('/kpiFee', handleKpiFee)

export const handleTopCommerces = async (req, res) => {
  let startDate = req.body.startDate || false;
  let endDate = req.body.endDate || false;

  if (!startDate || !endDate) {
    return res.json(errorResponse({
      message: 'Invalid Parameters'
    }))
  }
  const userMemo = {}

  const result = await transactionLog
    .orderByChild('date')
    .startAt(startDate)
    .endAt(endDate)
    .once('value');
  const transactions = result.val()
  Object.keys(transactions).map(e => transactions[e])
    .filter(tran => tran.transactionType === 'Send'
      && (tran.transactionRelationship === 'C2U'
        || tran.transactionRelationship === 'C2C'
        || tran.transactionRelationship === 'C2G'))
    .forEach(tran => {
      userMemo[tran.senderUid] = userMemo[tran.senderUid]
        ? ({
          ...userMemo[tran.senderUid],
          count: userMemo[tran.senderUid].count + 1,
          amount: userMemo[tran.senderUid].amount + Number(tran.amount)
        })
        : ({
          count: 1,
          amount: Number(tran.amount),
          profilePicture: tran.senderProfilePicture,
          email: tran.senderEmail,
          uid: tran.senderUid,
          name: tran.senderUsername
        })
    })

  Object.keys(transactions).map(e => transactions[e])
    .filter(tran => tran.transactionType === 'Receive'
      && (tran.transactionRelationship === 'C2C'
        || tran.transactionRelationship === 'U2C'
        || tran.transactionRelationship === 'G2C'))
    .forEach(tran => {
      userMemo[tran.receiverUid] = userMemo[tran.receiverUid]
        ? ({
          ...userMemo[tran.receiverUid],
          count: userMemo[tran.receiverUid].count + 1,
          amount: userMemo[tran.receiverUid].amount + Number(tran.amount)
        })
        : ({
          count: 1,
          amount: Number(tran.amount),
          profilePicture: tran.receiverProfilePicture,
          email: tran.receiverEmail,
          uid: tran.receiverUid,
          name: tran.receiverUsername
        })
    })
  return res.json(successResponse(
    Object
      .keys(userMemo)
      .map(key => userMemo[key])
      .sort((a, b) => b.amount - a.amount)
  ))
}
app.post('/topCommerces', handleTopCommerces)

export const handleTopUsers = async (req, res) => {
  let startDate = req.body.startDate || false;
  let endDate = req.body.endDate || false;
  if (!startDate || !endDate) {
    return res.json(errorResponse({
      message: 'Invalid Parameters'
    }))
  }
  const userMemo = {}

  const result = await transactionLog
    .orderByChild('date')
    .startAt(startDate)
    .endAt(endDate)
    .once('value');
  const transactions = result.val()
  Object.keys(transactions).map(e => transactions[e])
    .filter(tran => tran.transactionType === 'Send'
      && (tran.transactionRelationship === 'U2U'
        || tran.transactionRelationship === 'U2C'
        || tran.transactionRelationship === 'U2G'))
    .forEach(tran => {
      userMemo[tran.senderUid] = userMemo[tran.senderUid]
        ? ({
          ...userMemo[tran.senderUid],
          count: userMemo[tran.senderUid].count + 1,
          amount: userMemo[tran.senderUid].amount + Number(tran.amount)
        })
        : ({
          count: 1,
          amount: Number(tran.amount),
          profilePicture: tran.senderProfilePicture,
          email: tran.senderEmail,
          uid: tran.senderUid,
          name: tran.senderUsername
        })
    })

  Object.keys(transactions).map(e => transactions[e])
    .filter(tran => tran.transactionType === 'Receive'
      && (tran.transactionRelationship === 'U2U'
        || tran.transactionRelationship === 'C2U'
        || tran.transactionRelationship === 'G2U'))
    .forEach(tran => {
      userMemo[tran.receiverUid] = userMemo[tran.receiverUid]
        ? ({
          ...userMemo[tran.receiverUid],
          count: userMemo[tran.receiverUid].count + 1,
          amount: userMemo[tran.receiverUid].amount + Number(tran.amount)
        })
        : ({
          count: 1,
          amount: Number(tran.amount),
          profilePicture: tran.receiverProfilePicture,
          email: tran.receiverEmail,
          uid: tran.receiverUid,
          name: tran.receiverUsername
        })
    })
  return res.json(successResponse(
    Object
      .keys(userMemo)
      .map(key => userMemo[key])
      .sort((a, b) => b.amount - a.amount)
  ))
}
app.post('/topUsers', handleTopUsers)

export const handleTransferVsPurchase = async (req, res) => {
  let today = req.body.date || false;
  if (!today) {
    return res.json({
      message: "date is undefined",
      success: false,
    })
  }
  let lastWeek = moment(today).utc().subtract(1, 'week').startOf('isoWeek').format('YYYY-MM-DD').toString();
  let endLastWeek = moment(today).utc().subtract(1, 'week').endOf('isoWeek').format('YYYY-MM-DD').toString();
  let currentWeek = moment(today).utc().startOf('isoWeek').format('YYYY-MM-DD').toString();
  let lastMonth = moment(today).utc().subtract(1, 'month').startOf('month').format('YYYY-MM-DD').toString();
  let endLastMonth = moment(today).utc().subtract(1, 'month').endOf('month').format('YYYY-MM-DD').toString();
  let yesterday = moment(today).utc().subtract(1, 'days').format('YYYY-MM-DD').toString();
  let lastYear = moment(today).utc().subtract(1, 'year').startOf('year').format('YYYY-MM-DD').toString();
  let endLastYear = moment(today).utc().subtract(1, 'year').endOf('year').format('YYYY-MM-DD').toString();
  let currentMonth = moment(today).utc().startOf('month').format('YYYY-MM-DD').toString();
  let currentYear = moment(today).utc().startOf('year').format('YYYY-MM-DD').toString();

  let result = []
  await Promise.all([
    activityTransferPurchase(today, today),
    activityTransferPurchase(yesterday, today),
    activityTransferPurchase(currentWeek, today),
    activityTransferPurchase(lastWeek, endLastWeek),
    activityTransferPurchase(currentMonth, today),
    activityTransferPurchase(lastMonth, endLastMonth),
    activityTransferPurchase(currentYear, today),
    activityTransferPurchase(lastYear, endLastYear)
  ])
    .then(values => {
      result = values
      console.log(values);
    })

  return res.json({
    today: result[0],
    yesterday: result[1],
    currentWeek: result[2],
    lastWeek: result[3],
    currentMonth: result[4],
    lastMonth: result[5],
    currentYear: result[6],
    lastYear: result[7]
  })
}
app.post('/transferVsPurchase', handleTransferVsPurchase)

export const handleBlacklistReport = async (req, res) => {
  const blacklist = admin.database().ref('/transactionBlacklist');
  let report = []

  await blacklist.orderByChild('date').once('value').then(snapshot => {
    snapshot.forEach(bl => {
      let blData = {
        date: bl.val().date,
        amount: bl.val().amount,
        transactionNumber: bl.val().transactionNumber,
        uid: bl.val().uid,
        username: bl.val().username
      }
      report.push(blData);
    })
  });
  return res.json({
    report: report
  })
}
app.post('/blacklistReport', handleBlacklistReport)

export const handlePendingIssues = async (req, res) => {
  let pending = []
  issues.orderByChild('date').once('value').then(snapshot => {
    snapshot.forEach(issue => {
      if (issue.val().status === 'Pending') {
        let issueData = {
          assigned: issue.val().assigned,
          attachments: issue.val().attachments,
          category: issue.val().category,
          date: issue.val().createdDateTime,
          status: issue.val().status,
          user: issue.val().userData,
          messages: issue.val().userMessages
        }
        pending.push(issueData);
      }
    })
    return res.json({
      issues: pending
    })
  })
}
app.post('/pendingIssues', handlePendingIssues)

export const handleSolvedIssues = async (req, res) => {
  let solved = []
  issues.orderByChild('date').once('value').then(snapshot => {
    snapshot.forEach(issue => {
      if (issue.val().status === 'Solved') {
        let issueData = {
          assigned: issue.val().assigned,
          attachments: issue.val().attachments,
          category: issue.val().category,
          date: issue.val().createdDateTime,
          status: issue.val().status,
          user: issue.val().userData,
          messages: issue.val().userMessages
        }
        solved.push(issueData);
      }
    })
  })
  return res.json({
    issues: solved
  });
}
app.post('/solvedIssues', handleSolvedIssues)

export const handleUserBlacklistReport = async (req, res) => {
  let userBl = []
  await userBlacklist.orderByChild('date').once('value').then(snapshot => {
    snapshot.forEach(element => {
      let userData = {
        username: element.val().username,
        email: element.val().email,
        phone: element.val().phone,
        profilePicture: element.val().profilePicture,
        thumbnail: element.val().thumbnail,
        date: element.val().date
      }
      userBl.push(userData);
    });
  });
  let data = userBl.reverse();
  return res.json({
    usersBlacklist: data
  });
}
app.post('/userBlacklistReport', handleUserBlacklistReport)

export const handleUserReport = async (req, res) => {
  let today = req.body.date || false;
  if (!today) {
    return res.json({
      message: "date is undefined",
      success: false,
    })
  }
  let lastWeek = moment(today).utc().subtract(1, 'week').startOf('isoWeek').format('YYYY-MM-DD').toString();
  let endLastWeek = moment(today).utc().subtract(1, 'week').endOf('isoWeek').format('YYYY-MM-DD').toString();
  let currentWeek = moment(today).utc().startOf('isoWeek').format('YYYY-MM-DD').toString();
  let lastMonth = moment(today).utc().subtract(1, 'month').startOf('month').format('YYYY-MM-DD').toString();
  let endLastMonth = moment(today).utc().subtract(1, 'month').endOf('month').format('YYYY-MM-DD').toString();
  let yesterday = moment(today).utc().subtract(1, 'days').format('YYYY-MM-DD').toString();
  let currentMonth = moment(today).utc().startOf('month').format('YYYY-MM-DD').toString();
  let result = []
  await Promise.all([usersKPI(today, today),
  usersKPI(yesterday, today),
  usersKPI(currentWeek, today),
  usersKPI(lastWeek, endLastWeek),
  usersKPI(lastMonth, endLastMonth),
  usersKPI(currentMonth, today)
  ])
    .then(values => {
      result = values
      console.log(values);
    })
  return res.json({
    today: result[0],
    yesterday: result[1],
    currentWeek: result[2],
    lastWeek: result[3],
    lastMonth: result[4],
    currentMonth: result[5],
  })
}
app.post('/userReport', handleUserReport)

export const handleTransactionsByClient = async (req, res) => {
  let startDate = req.body.startDate || false;
  let endDate = req.body.endDate || false;
  let uid = req.body.uid || false;
  let transactionType = req.body.transactionType || false;

  let transactionsArray = []
  if (!uid || !transactionType || !startDate || !endDate) {
    return res.json(errorResponse({
      message: 'Invalid Parameters'
    }))
  }
  let user = await getUserByUID(uid)
  if (user === undefined) {
    return res.json(errorResponse({
      message: 'User Not Found'
    }))
  }
  if (transactionType !== 'Send' && transactionType !== 'Receive') {
    return res.json(errorResponse({
      message: 'Type must be Send or Receive'
    }))
  }
  let snapshot = await transactionHistory.child(uid).orderByChild('date').startAt(startDate).endAt(endDate).once('value')
  let transactions: ITransactionHistory[] = snapshot.val()
  for (const key in transactions) {
    if (transactions.hasOwnProperty(key)) {
      const transactionData = transactions[key];
      if (transactionData.transactionType === transactionType
        && transactionData.status === 'Approved') {
        transactionsArray.push({
          date: transactionData.dateTime,
          sender: transactionData.senderUsername,
          receiver: transactionData.receiverUsername,
          amount: Number(transactionData.amount),
          type: transactionData.transactionType
        })
      }
    }
  }
  return res.json(successResponse({
    transactionsArray
  }))
}
app.post('/transactionsByClient', handleTransactionsByClient)

export const handleExpensesAndIncome = async (req, res) => {
  let startDate = req.body.startDate || false;
  let endDate = req.body.endDate || false;
  let uid = req.body.uid || false;
  let expenses = 0
  let inconme = 0
  if (!uid || !startDate || !endDate) {
    return res.json(errorResponse({
      message: 'Invalid Parameters'
    }))
  }
  let user = await getUserByUID(uid)
  if (user === undefined) {
    return res.json(errorResponse({
      message: 'User Not Found'
    }))
  }
  let snapshot = await transactionHistory.child(uid).orderByChild('date').startAt(startDate).endAt(endDate).once('value')
  let transactions: ITransactionHistory[] = snapshot.val()
  for (const key in transactions) {
    if (transactions.hasOwnProperty(key)) {
      const transactionData = transactions[key];
      if (transactionData.status === 'Approved') {
        switch (transactionData.transactionType) {
          case 'Send':
            expenses += Number(transactionData.amount);
            break;
          case 'Receive':
            inconme += Number(transactionData.amount);
            break;
        }
      }
    }
    return res.json(successResponse({
      expenses,
      inconme,
      user: uid
    }))
  }
}
app.post('/expensesAndIncome', handleExpensesAndIncome)

export const handleTopOperators = async (req, res) => {
  let topOperatorsIssues = []
  let topOperatorsIssuesResolved = []

  await operators.orderByChild('issues').limitToLast(20).once('value').then(snapshot => {
    snapshot.forEach(operator => {
      topOperatorsIssues.push(operator.val())
    });
  })

  await operators.orderByChild('issuesResolved').limitToLast(20).once('value').then(snapshot => {
    snapshot.forEach(operator => {
      topOperatorsIssuesResolved.push(operator.val())
    });
  })

  return res.json(successResponse({
    topOperatorsIssues,
    topOperatorsIssuesResolved
  }))
}
app.post('/topOperators', handleTopOperators)

export const handleShowSettings = async (req, res) => {
  let result = await systemSettings.once('value');
  let setting = result.val();
  return res.json(successResponse({ setting }))
}
app.post('/showSettings', handleShowSettings)

export const handleChangeSettings = async (req, res) => {
  let option = req.body.option || false;
  let newValue = req.body.newValue || false;
  let attributes = ['pendingIssues', 'feeUsers',
    'feeCommerces', 'limitUserBL', 'limitTransferBL']
  if (!option || !newValue) {
    return res.json(errorResponse({
      message: 'Invalid Parameters'
    }))
  }
  if (attributes.indexOf(option) === -1) {
    return res.json(errorResponse({
      message: 'Option is invalid'
    }))
  }
  await systemSettings.update({ [option]: Number(newValue) })
  return res.json(successResponse({ message: 'Updated' }))
}
app.post('/changeSettings', handleChangeSettings)

// The gualy http function
export const gualyBack = functions.https.onRequest(app)

// TRIGGERS
export const moneyRequestTrigger = functions.database.ref('moneyRequest/{uid}/{transactionID}').onWrite(async (change, context) => {
  console.log(context)

  try {
    if (!change.before.exists()) {
      return
    }
    if (!change.after.exists()) {
      return
    }
    const transactionData: ITransactionHistory = change.after.val()
    console.log(`Esta es la fucking data ${JSON.stringify(transactionData)}`)
    const previousTransactionData: ITransactionHistory = change.before.val()
    if (transactionData.transactionType === 'Receive') {
      return
    }
    if (transactionData.transactionType === 'Send' && transactionData.status === 'Approved' && transactionData.status !== previousTransactionData.status) {
      let moneyRequestResult = await proccessMoneyRequest(transactionData)
      if (!moneyRequestResult.success) {
        return
      }
      return
    }
    if (transactionData.transactionType === 'Send' && transactionData.status === 'Rejected' && transactionData.status !== previousTransactionData.status && previousTransactionData.status !== 'Approved') {
      let moneyRequestResult = await proccessMoneyRequest(transactionData, i18n.__('MESSAGE:REJECTED_PAYMENT_REQUEST'))
      // await cleanMoneyRequest(transactionData.senderUid, transactionData.idTransaction)
      // await cleanMoneyRequest(transactionData.receiverUid, transactionData.transactionLinked)
      if (!moneyRequestResult.success) {
        console.log(`Trigger Failed at Rejected Transaction. Error: ${moneyRequestResult.error}`)
      }
      let templatePath = `${__dirname}/emailTemplates/rejectedMoneyRequest.html`
      let fileBuffer = fs.readFileSync(templatePath)
      let sg = new SendGridService()
      let subject = i18n.__('MESSAGE:REJECTED_PAYMENT_REQUEST')
      await sg.send('Gualy',
        infoEmail,
        [transactionData.receiverEmail],
        subject,
        fileBuffer.toString(),
        {
          '%senderusername%': transactionData.senderUsername,
          '%username%': transactionData.receiverUsername,
          '%currency%': transactionData.currency,
          '%amount%': transactionData.amount.toString(),
          '%subject%': subject,
          '%deepLink%': deepLink,
          '%ayuda%': ayuda,
          '%faq%': faq,
          '%condiciones%': condiciones,
          '%facebook%': facebook,
          '%twitter%': twitter,
          '%instagram%': instagram,
          '%previewText%': previewText
        })
      return
    }
    return
  } catch (error) {
    console.log(error)
    return
  }
})

export const securityMessage = functions.database.ref('/users/{uid}/deviceUniqueToken').onUpdate(async (change, context) => {
  if (!context.params.uid || !change.after.exists() || !change.before.exists()) {
    return
  }
  const currentDeviceToken = change.after.val()
  const previousDeviceToken = change.before.val()
  if (currentDeviceToken === previousDeviceToken) {
    return
  }
  let snapshot: database.DataSnapshot
  let user: IUserData
  try {
    snapshot = await getUserByUID(context.params.uid)
    if (!snapshot.exists()) {
      return i18n.__('ERROR:UID_NOT_FOUND')
    }
    user = snapshot.val()
    let secureDevicesArray = user.secureDevices
    if (!secureDevicesArray.includes(currentDeviceToken)) {
      let url = `${clientAddress}token=${currentDeviceToken}`
      let templatePath = `${__dirname}/emailTemplates/newDeviceDetected.html`
      let fileBuffer = fs.readFileSync(templatePath)
      let sg = new SendGridService()
      let subject = i18n.__('LABEL:SECURITY_ALERT')
      await sg.send(
        'Gualy',
        infoEmail,
        [user.email],
        subject,
        fileBuffer.toString(),
        {
          '%username%': user.name,
          '%subject%': subject,
          '%deepLink%': deepLink,
          '%ayuda%': ayuda,
          '%faq%': faq,
          '%condiciones%': condiciones,
          '%facebook%': facebook,
          '%twitter%': twitter,
          '%instagram%': instagram,
          '%previewText%': previewText,
          '%deepLinkSecureDevice%': url,
          '%deepLinkUnsecureDevice%': deepLinkUnsecureDevice,
          '%supportEmail%': supportEmail,
        }
      )
    }
    return
  } catch (error) {
    console.log(i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message }))
    return i18n.__('INTERNAL_SERVER_ERROR', { errorMessage: error.message })
  }
})

export const transactionLogTrigger = functions.database.ref('/transactionHistory/{uid}/{transactionid}').onWrite(async (change, context) => {
  const transactionData: ITransactionHistory = change.after.val()
  const oldData: boolean = change.before.exists()
  console.log(context)
  console.log('transactionLogTrigger')
  if (!transactionData.mode) {
    console.log(`missing mode`)
    console.log(transactionData)
    return
  }
  if (!transactionData.amount) {
    console.log(`missing amount`)
    console.log(transactionData)
    return
  }
  if (transactionData.mode === 'Purchase' || transactionData.mode === 'Withdraw') {
    console.log(`Transaction type ${transactionData.mode}`)
    return
  }

  if (
    transactionData.mode === 'Send' &&
    transactionData.status === 'Approved' &&
    !oldData
  ) {
    console.log('Transaction log triggers DATA')
    console.log(transactionData)
    try {
      let userID = transactionData.mode === 'Send' ? transactionData.senderUid : transactionData.receiverUid
      let linkedUserID = transactionData.mode === 'Send' ? transactionData.receiverUid : transactionData.senderUid
      console.log('checking linked data')
      console.log(`user id ${userID}`)
      console.log(`linked user id ${linkedUserID}`)
      console.log(`check for user data ${transactionData.transactionType}`)

      // const snapshot = await getTransactionByID(linkedUserID, transactionData.transactionLinked)
      // if (!snapshot.exists()) {
      //   console.log('Not linked transaction')
      //   return
      // }
      let linkedTransactionData = { ...transactionData }
      let firstKey = linkedTransactionData.transactionLinked
      let secondKey = transactionData.idTransaction
      linkedTransactionData.status = 'Approved'
      linkedTransactionData.transactionType = 'Receive'
      linkedTransactionData.mode = 'Receive'
      linkedTransactionData.idTransaction = firstKey
      linkedTransactionData.transactionLinked = secondKey
      // let linkedTransactionData: ITransactionHistory = snapshot.val()
      const date = momentTz.tz('America/Caracas').format('YYYY-MM-DD')
      const time = momentTz.tz('America/Caracas').format('HH:mm:ss')
      const timestamp = Date.now()
      console.log('date: ', date)
      console.log('time: ', time)
      transactionData.date = date
      transactionData.time = time
      transactionData.dateTime = `${date} ${time}`
      transactionData.timestamp = timestamp
      linkedTransactionData.time = time
      linkedTransactionData.date = date
      linkedTransactionData.dateTime = `${date} ${time}`
      linkedTransactionData.timestamp = timestamp
      let dataForEmail = { ...transactionData }
      let user: IUserData = (await getUserByUID(userID)).val()
      const linkedUser: IUserData = (await getUserByUID(linkedUserID)).val()
      transactionData.senderDni = `${user.dni.type}${user.dni.id}`
      transactionData.receiverDni = `${linkedUser.dni.type}${linkedUser.dni.id}`
      linkedTransactionData.senderDni = `${user.dni.type}${user.dni.id}`
      linkedTransactionData.receiverDni = `${linkedUser.dni.type}${linkedUser.dni.id}`
      let firstRelationship = user.type === 'client' ? 'U' : 'C'
      let secondRelationship = linkedUser.type === 'client' ? 'U' : 'C'
      let transactionRelationship = `${firstRelationship}2${secondRelationship}`
      transactionData.transactionRelationship = transactionData.transactionRelationship ? transactionData.transactionRelationship : transactionRelationship
      linkedTransactionData.transactionRelationship = linkedTransactionData.transactionRelationship ? linkedTransactionData.transactionRelationship : transactionRelationship
      linkedTransactionData.mode = 'Receive'
      linkedTransactionData.transactionType = 'Receive'

      console.log(`fecthed users`)
      console.log(`user data ${user.FCMToken} ${user.email}`)
      console.log(`linked userDATA ${linkedUser.name}`)
      console.log(`saving ${transactionData.transactionType}`)
      await saveTransactionData(transactionData.idTransaction, transactionData)
      await saveTransactionData(linkedTransactionData.idTransaction, linkedTransactionData)
      await updateTransactionToUserHistory(userID, transactionData)
      await updateTransactionToUserHistory(linkedUserID, linkedTransactionData)
      console.log(`saved ${transactionData.transactionType}`)
      if (transactionData.source === 'toUser') {
        console.log({
          '%amount%': dataForEmail.amount.toString(),
          '%amountToShow%': dataForEmail.amount.toString(),
          '%ayuda%': ayuda,
          '%condiciones%': condiciones,
          '%currency%': dataForEmail.currency || 'Bs.S',
          '%date%': dataForEmail.dateTime,
          '%deepLink%': deepLink,
          '%description%': dataForEmail.description,
          '%facebook%': facebook,
          '%faq%': faq,
          '%fee%': '0',
          '%instagram%': instagram,
          '%net%': dataForEmail.amount.toString(),
          '%previewText%': previewText,
          '%receiverUsername%': dataForEmail.receiverUsername,
          '%senderUsername%': dataForEmail.senderUsername,
          '%subject%': i18n.__('MESSAGE:SUCCESSFUL_RECEIVE_PAYMENT_EMAIL_SUBJECT'),
          '%supportEmail%': supportEmail,
          '%transactionId%': dataForEmail.idTransaction,
          '%twitter%': twitter
        })
        // let amount: any = transactionData.amount
        let sg: SendGridService = new SendGridService()
        let transaction: Array<Promise<boolean>> = []
        // if (linkedUser.FCMToken) {
        //   transaction.push(pushNotificationSender(
        //     [transactionData.receiverUid], 'Gualy',
        //     i18n.__('MESSAGE:SUCCESSFUL_RECEIVE_TRANSFER', {
        //       user: transactionData.senderUsername,
        //       amount,
        //       currency: transactionData.currency
        //     }), {
        //       amount: transactionData.amount,
        //       currency: transactionData.currency,
        //       name: transactionData.senderUsername,
        //       pic: transactionData.senderProfilePicture,
        //       transactionID: transactionData.transactionLinked,
        //       message: i18n.__('MESSAGE:SUCCESSFUL_RECEIVE_TRANSFER', {
        //         user: transactionData.senderUsername,
        //         amount,
        //         currency: transactionData.currency
        //       })
        //     }, 'transaction_notification'
        //   ))
        // }
        let subject = i18n.__('MESSAGE:SUCCESSFUL_RECEIVE_PAYMENT_EMAIL_SUBJECT')
        let templatePath = `${__dirname}/emailTemplates/paymentInvoice.html`
        let fileBuffer = fs.readFileSync(templatePath)
        transaction.push(
          sg.send(
            'Gualy',
            infoEmail,
            [linkedUser.email],
            subject,
            fileBuffer.toString(),
            {
              '%amount%': dataForEmail.amount.toString(),
              '%amountToShow%': dataForEmail.amount.toString(),
              '%ayuda%': ayuda,
              '%condiciones%': condiciones,
              '%currency%': dataForEmail.currency || 'Bs.S',
              '%date%': dataForEmail.dateTime,
              '%deepLink%': deepLink,
              '%description%': dataForEmail.description,
              '%facebook%': facebook,
              '%faq%': faq,
              '%fee%': '0',
              '%instagram%': instagram,
              '%net%': dataForEmail.amount.toString(),
              '%previewText%': previewText,
              '%receiverUsername%': dataForEmail.receiverUsername,
              '%senderUsername%': dataForEmail.senderUsername,
              '%subject%': subject,
              '%supportEmail%': supportEmail,
              '%transactionId%': dataForEmail.idTransaction,
              '%twitter%': twitter
            }
          )
        )

        // if (user.FCMToken) {
        //   transaction.push(pushNotificationSender(
        //     [transactionData.senderUid], 'Gualy',
        //     i18n.__('MESSAGE:SUCCESSFUL_SEND_TRANSFER', {
        //       user: transactionData.receiverUsername,
        //       amount,
        //       currency: transactionData.currency
        //     }), {
        //       amount: transactionData.amount,
        //       currency: transactionData.currency,
        //       name: transactionData.receiverUsername,
        //       pic: transactionData.receiverProfilePicture,
        //       transactionID: transactionData.idTransaction,
        //       message: i18n.__('MESSAGE:SUCCESSFUL_SEND_TRANSFER', {
        //         user: transactionData.receiverUsername,
        //         amount,
        //         currency: transactionData.currency
        //       })
        //     }, 'transaction_notification'
        //   ))
        // }

        let senderTemplatePath = `${__dirname}/emailTemplates/senderPaymentInvoice.html`
        let senderFileBuffer = fs.readFileSync(senderTemplatePath)
        let senderSubject = i18n.__('LABEL:SENT_PAYMENT')

        console.log('Gualy',
          infoEmail,
          [user.email],
          senderSubject,
          senderFileBuffer.toString())
        transaction.push(
          sg.send(
            'Gualy',
            infoEmail,
            [user.email],
            senderSubject,
            senderFileBuffer.toString(),
            {
              '%amount%': dataForEmail.amount.toString(),
              '%amountToShow%': dataForEmail.amount.toString(),
              '%ayuda%': ayuda,
              '%condiciones%': condiciones,
              '%currency%': dataForEmail.currency || 'Bs.S',
              '%date%': dataForEmail.dateTime,
              '%deepLink%': deepLink,
              '%description%': dataForEmail.description,
              '%facebook%': facebook,
              '%faq%': faq,
              '%fee%': '0',
              '%instagram%': instagram,
              '%net%': dataForEmail.amount.toString(),
              '%previewText%': previewText,
              '%receiverUsername%': dataForEmail.receiverUsername,
              '%senderUsername%': dataForEmail.senderUsername,
              '%subject%': subject,
              '%supportEmail%': supportEmail,
              '%transactionId%': dataForEmail.idTransaction,
              '%twitter%': twitter
            }
          )
        )

        if (transaction.length > 0) {
          await Promise.all(transaction)
        }

      }
      console.log('Transaction procced')
      return
    } catch (error) {
      console.log('Error at transactionLogTrigger')
      console.log(error)
      console.log(error.response.body.errors)
      return
    }
  }
  return
})

export const generateThumbnail = functions.storage.object().onFinalize(object => {
  const filePath = object.name;
  const fileName = filePath.split('/').pop();
  const fileBucket = object.bucket;
  const bucket = gcs.bucket(fileBucket);
  const tmpFilePath = `/tmp/${fileName}`;
  //root db
  const file = bucket.file(filePath);
  const thumbFilePath = filePath.replace(/(\/)?([^\/]*)$/, '$1thumb_$2');

  console.log("object", object);

  let aux = filePath.split('/');
  let root = aux[0]
  console.log(`Root: ${root}`)
  if (root === 'brochure') {
    console.log('brochure')
    return
  }
  let uid = aux[1];
  console.log('filepath', filePath)
  console.log("uid", uid);

  if (fileName.startsWith('thumb_')) {
    console.log("ya tiene thumb");
    return
  }

  if (!object.contentType.startsWith('image/')) {
    console.log("no es una imagen");
    return
  }

  //descargo la imagen en el path temporal para modificarla
  return bucket.file(filePath).download({
    destination: tmpFilePath
  })
    .then(() => {
      console.log("imagen descargada en ", tmpFilePath);
      //spawn ejecuta el cli de imageMagick

      return spawn('convert', [tmpFilePath, '-thumbnail', '200x200>', tmpFilePath])
    })
    .then(() => {
      console.log("thmb creado")
      return bucket.upload(tmpFilePath, {
        destination: thumbFilePath
      })
    })
    .then(() => {
      const thumbFile = bucket.file(thumbFilePath)

      const config = {
        action: 'read',
        expires: '03-09-2020'
      }

      return Promise.all([
        thumbFile.getSignedUrl(config),
        file.getSignedUrl(config)
      ])
    })
    .then(async res => {
      const thumbResult = res[0];
      const thumbResultUrl = thumbResult[0]
      let checkAccessToken: database.DataSnapshot = await accessToken.child(uid).once('value')
      let checkCommerce: database.DataSnapshot = await commerce.child(uid).once('value')
      if (checkAccessToken.exists()) {
        return accessToken.child(uid).update({ thumbnail: thumbResultUrl })
      } else {
        if (checkCommerce.exists()) {
          await commerce.child(uid).update({ thumbnail: thumbResultUrl })
        }
        return users.child(uid).update({ thumbnail: thumbResultUrl })
      }
    })
})

export const requestOrdersTrigger = functions.database.ref('/pendingOrders/{orderID}').onUpdate(async (change, context) => {
  try {
    if (!change.after.exists()) {
      console.log('Registro no existe')
      return
    }
    if (change.before.exists()) {
      console.log('Registro modificado')
      const eventData: ITransactionHistory = change.after.val()
      console.log('new data')
      console.log(eventData)
      console.log(eventData.bankReference)
      const oldData: ITransactionHistory = change.before.val()
      console.log('old Data')
      console.log(oldData)
      let snapshot = await getUserByUID(eventData.senderUid)
      let user: IUserData = snapshot.val()
      if (context.authType === 'USER') {
        let snapshot = await getUserByUID(context.auth.uid)
        let operator: IUserData = snapshot.val()
        eventData.operator = {
          email: operator.email,
          name: operator.name,
          profilePicture: operator.thumbnail || operator.profilePicture || '',
          uid: operator.userKey
        }
      } else if (context.authType === 'ADMIN') {
        eventData.operator = {
          email: 'Admin',
          name: 'Admin',
          profilePicture: '',
          uid: 'Admin'
        }
      } else if (context.authType === 'UNAUTHENTICATED') {
        eventData.status = 'Pending'
        await saveTransactionData(eventData.idTransaction, eventData)
        return
      }
      console.log(eventData.status)
      console.log(oldData.status)
      eventData.timestamp = Date.now()
      if (eventData.status === 'Approved') { // && eventData.status !== oldData.status
        const sg = new SendGridService()
        let newAmount = addAmount(user.amount.toString(), eventData.amount.toString())
        let pendingDeposit = user.pendingDeposit - Number(eventData.amount)
        await Promise.all([
          saveTransactionData(eventData.idTransaction, eventData),
          saveTransactionDataFromRequestOrdersToUserHistory(eventData.idTransaction, eventData),
          updateUserData(eventData.senderUid, { amount: newAmount, pendingDeposit }),
          updateFromRequestOrders(eventData.idTransaction, eventData),
          createUserNotification(eventData.senderUid, {
            amount: eventData.amount,
            currency: eventData.currency,
            description: eventData.description,
            mode: 'Deposit',
            senderUid: eventData.senderUid,
            senderEmail: eventData.senderEmail,
            senderProfilePicture: eventData.senderProfilePicture,
            senderUsername: eventData.senderUsername,
            status: eventData.status,
            userKey: eventData.senderUid,
            userBankAccount: eventData.userBankAccount,
            timestamp: Date.now(),
            type: 'transaction_notification'
          })
        ])
        console.log('Cumple las condiciones')
        let templatePath = `${__dirname}/emailTemplates/approvedBankTransfer.html`
        let fileBuffer = fs.readFileSync(templatePath)
        await pushNotificationSender([eventData.senderUid], 'Gualy', i18n.__('MESSAGE:SUCCESSFUL_BANK_DEPOSIT_TRANSFER'), {}, 'notification')
        const sendGridRes = await sg.send(
          'Gualy',
          infoEmail,
          [user.email],
          i18n.__('LABEL:RECEIVED_DEPOSIT'),
          fileBuffer.toString(),
          {
            '%username%': user.name,
            '%subject%': i18n.__('LABEL:RECEIVED_DEPOSIT'),
            '%fee%': 0,
            '%net%': String(eventData.amount),
            '%amount%': String(eventData.amount),
            '%currency%': eventData.currency,
            '%transactionId%': eventData.idTransaction,
            '%date%': eventData.dateTime,
            '%deepLink%': deepLink,
            '%ayuda%': ayuda,
            '%faq%': faq,
            '%condiciones%': condiciones,
            '%facebook%': facebook,
            '%twitter%': twitter,
            '%instagram%': instagram,
            '%previewText%': previewText,
            '%supportEmail%': supportEmail
          }
        )
        console.log('sendGridRes on requestOrdersTriger: ', sendGridRes)
        console.log('send push notification and email')
        return
      }
      if (eventData.status === 'Rejected') { // && eventData.status !== oldData.status
        const sg = new SendGridService()
        let pendingDeposit = user.pendingDeposit - Number(eventData.amount)
        await Promise.all([
          saveTransactionData(eventData.idTransaction, eventData),
          saveTransactionDataFromRequestOrdersToUserHistory(eventData.idTransaction, eventData),
          updateUserData(eventData.senderUid, { pendingDeposit }),
          updateFromRequestOrders(eventData.idTransaction, eventData),
          createUserNotification(eventData.senderUid, {
            amount: eventData.amount,
            currency: eventData.currency,
            description: eventData.description,
            mode: 'Deposit',
            senderUid: eventData.senderUid,
            senderEmail: eventData.senderEmail,
            senderProfilePicture: eventData.senderProfilePicture,
            senderUsername: eventData.senderUsername,
            status: eventData.status,
            userKey: eventData.senderUid,
            userBankAccount: eventData.userBankAccount,
            timestamp: Date.now(),
            type: 'transaction_notification'
          })
        ])
        console.log('Rejected transaction')
        let templatePath = `${__dirname}/emailTemplates/rejectedBankTransfer.html`
        let fileBuffer = fs.readFileSync(templatePath)
        await pushNotificationSender([user.userKey], 'Gualy', i18n.__('ERROR:UNAUTHORIZED_TRANSACTION'), {}, 'notification')
        await sg.send(
          'Gualy',
          infoEmail,
          [user.email],
          i18n.__('LABEL:REJECTED_DEPOSIT'),
          fileBuffer.toString(),
          {
            '%username%': user.name,
            '%subject%': i18n.__('LABEL:REJECTED_DEPOSIT'),
            '%fee%': 0,
            '%net%': eventData.amount.toString(),
            '%amount%': eventData.amount.toString(),
            '%currency%': eventData.currency,
            '%transactionId%': eventData.bankReference,
            '%date%': eventData.dateTime,
            '%deepLink%': deepLink,
            '%ayuda%': ayuda,
            '%faq%': faq,
            '%condiciones%': condiciones,
            '%facebook%': facebook,
            '%twitter%': twitter,
            '%instagram%': instagram,
            '%previewText%': previewText,
            '%supportEmail%': supportEmail
          }
        )
        console.log('send push notification and email')
        return
      }
      console.log('No cumplio las condiciones')
      return
    } else {
      console.log('El registro es nuevo')
      return
    }
  } catch (error) {
    console.log('Error at requestOrdersTrigger')
    console.log(error)
    return
  }
})

export const sendSupportEmail = functions.database.ref('/messagesFromUsers/{pushKey}')
  .onWrite(async (change, context) => {
    if (change.before.exists()) {
      return null
    }
    if (!change.after.exists()) {
      return null
    }
    const dataCollection = change.after.val()
    console.log("dataCollection>", dataCollection)
    let templatePath = `${__dirname}/emailTemplates/userSupportMessage.html`
    let fileBuffer = fs.readFileSync(templatePath)
    let sg = new SendGridService()
    await sg.send('Gualy',
      infoEmail,
      [supportEmail],
      i18n.__('LABEL:USER_SUPPORT_MESSAGE'),
      fileBuffer.toString(),
      {
        '%username%': dataCollection.name,
        '%userKey%': dataCollection.userKey,
        '%useremail%': dataCollection.email,
        '%usermessage%': dataCollection.message,
        '%messagekey%': dataCollection.messageKey,
        '%subject%': i18n.__('LABEL:USER_SUPPORT_MESSAGE'),
        '%deepLink%': deepLink,
        '%ayuda%': ayuda,
        '%faq%': faq,
        '%condiciones%': condiciones,
        '%facebook%': facebook,
        '%twitter%': twitter,
        '%instagram%': instagram,
        '%previewText%': previewText,
        '%supportEmail%': supportEmail
      }
    )
    return
  })
